import test from 'node:test';
import assert from 'node:assert/strict';
import { createBulkManager, parseSelection } from '../web/bulk.mjs';
import { config } from '../web/config.mjs';
const workflowId = config.defaultWorkflowId;
function harness() {
  const map = new Map(), posts = []; let time = 0, userId = 'user';
  const storage = {getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,v), removeItem: k => map.delete(k)};
  const locks = {request: async (key, options, callback) => callback({name: key})};
  const workflow = {id: workflowId, name: 'Test', versionId: 'v1', scopes: ['workflow:read', 'workflow:execute'], nodes: [{name: 'Webhook', type: 'n8n-nodes-base.webhook'}]};
  const sources = Object.fromEntries(['1', '2', '3'].map(id => [id, {id, workflowId, status: 'success', stoppedAt: '2026-10-10T12:00:00Z', data: {resultData: {runData: {Webhook: [{startTime: 1, executionTime: 1, data: {main: [[{json: {id}}]]}}]}}}}]));
  const api = {user: async () => ({id: userId}), workflow: async () => workflow, execution: async id => sources[id], run: async (id, payload) => {posts.push(payload); return {executionId: String(100 + posts.length)};}};
  const options = {api, storage, locks, config, now: () => time};
  const bulk = createBulkManager(options), selection = parseSelection(workflowId, '1 2 3', config);
  return {bulk, options, selection, api, sources, workflow, map, posts, setTime(value) {time = value;}, setUser(value) {userId = value;}};
}
test('bulk preview reads all sources and requires full compatibility, matching selection and confirmation', async () => {
  const h = harness();
  await assert.rejects(h.bulk.submit(h.selection, true), {code: 'preview_required'});
  assert.equal((await h.bulk.preview(h.selection)).runnable, true); assert.equal(h.posts.length, 0); assert.equal(h.map.size, 0);
  await assert.rejects(h.bulk.submit(h.selection, false), {code: 'preview_required'});
  await h.bulk.preview(h.selection);
  await assert.rejects(h.bulk.submit([...h.selection].reverse(), true), {code: 'preview_required'});
  h.sources['2'].data.redactionInfo = {isRedacted: true};
  const preview = await h.bulk.preview(h.selection); assert.equal(preview.runnable, false);
  await assert.rejects(h.bulk.submit(h.selection, true), {code: 'preview_required'}); assert.equal(h.posts.length, 0);
});
test('bulk submits sequentially with a local marker before each POST and never persists payloads', async () => {
  const h = harness(); let inflight = 0;
  h.api.run = async (id, payload) => {
    assert.equal(++inflight, 1);
    const sourceId = payload.triggerToStartFrom.data.data.main[0][0].json.id;
    assert.ok([...h.map.values()].some(raw => {const record = JSON.parse(raw); return record.sourceExecutionId === sourceId && record.status === 'pending';}));
    h.posts.push(sourceId); await Promise.resolve(); inflight--; return {executionId: String(100 + h.posts.length)};
  };
  await h.bulk.preview(h.selection); const result = await h.bulk.submit(h.selection, true);
  assert.deepEqual(h.posts, ['1', '2', '3']); assert.equal(result.reason, 'complete');
  assert.deepEqual(result.rows.map(row => row.status), ['submitted', 'submitted', 'submitted']);
  assert.ok(![...h.map.values()].join('').includes('triggerToStartFrom'));
  assert.equal((await h.bulk.preview(h.selection)).runnable, false);
  await assert.rejects(h.bulk.submit(h.selection, true), {code: 'preview_required'});
});
test('bulk aborts on source, workflow or account change before a subsequent POST', async () => {
  for (const kind of ['source', 'workflow', 'account']) {
    const h = harness(); await h.bulk.preview(h.selection);
    h.api.run = async () => { h.posts.push(1);
      if (kind === 'source') h.sources['2'].data.resultData.runData.Webhook[0].data.main[0][0].json.changed = true;
      if (kind === 'workflow') h.workflow.settings = {changed: true};
      if (kind === 'account') h.setUser('other');
      return {executionId: '100'};
    };
    const result = await h.bulk.submit(h.selection, true);
    assert.equal(h.posts.length, 1); assert.equal(result.reason, 'error');
    assert.deepEqual(result.rows.map(row => row.status), ['submitted', 'blocked', 'not_sent']);
  }
});
test('bulk stops between POSTs and lost response leaves durable blockage without retry', async () => {
  const h = harness(); await h.bulk.preview(h.selection);
  const stopped = await h.bulk.submit(h.selection, true, rows => {if (rows[0].status === 'submitted') h.bulk.stop();});
  assert.equal(stopped.reason, 'stopped'); assert.equal(h.posts.length, 1);
  assert.deepEqual(stopped.rows.map(row => row.status), ['submitted', 'not_sent', 'not_sent']);
  const other = harness(); await other.bulk.preview(other.selection);
  other.api.run = async () => {other.posts.push(1); throw Object.assign(new Error(), {code: 'outcome_unknown'});};
  const unknown = await other.bulk.submit(other.selection, true);
  assert.equal(unknown.reason, 'error'); assert.equal(other.posts.length, 1);
  assert.equal(JSON.parse([...other.map.values()][0]).status, 'unknown');
  assert.equal((await other.bulk.preview(other.selection)).runnable, false);
});
test('bulk expiration, unavailable storage/locks and overlapping submission prevent extra POSTs', async () => {
  const expired = harness(); await expired.bulk.preview(expired.selection); expired.setTime(300001);
  await assert.rejects(expired.bulk.submit(expired.selection, true), {code: 'preview_required'}); assert.equal(expired.posts.length, 0);
  for (const kind of ['locks', 'storage']) {
    const h = harness(); if (kind === 'locks') h.options.locks.request = undefined; else h.options.storage.setItem = () => {throw new Error();};
    await h.bulk.preview(h.selection); const result = await h.bulk.submit(h.selection, true);
    assert.equal(result.reason, 'error'); assert.equal(h.posts.length, 0);
  }
  const h = harness(); let release, entered;
  const gate = new Promise(resolve => {release = resolve;}), started = new Promise(resolve => {entered = resolve;});
  h.api.run = async () => {h.posts.push(1); entered(); await gate; return {executionId: '100'};};
  await h.bulk.preview(h.selection); const pending = h.bulk.submit(h.selection, true); await started;
  await assert.rejects(h.bulk.submit(h.selection, true), {code: 'another_operation_busy'});
  h.bulk.stop(); release(); await pending; assert.equal(h.posts.length, 1);
});
