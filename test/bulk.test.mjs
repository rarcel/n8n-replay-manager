import test from 'node:test';
import assert from 'node:assert/strict';
import { createBulkManager, parseSelection } from '../web/bulk.mjs';
import { config } from '../web/config.mjs';
const workflowId = 'fixture-workflow';

test('preview bounds parallel reads, shares only in-flight checks and keeps order; submission rereads without sharing', async () => {
  const h = harness();
  let active = 0, peak = 0, workflowReads = 0, userReads = 0;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  h.api.user = async () => { userReads++; await delay(2); return {id: 'user'}; };
  h.api.workflow = async () => { workflowReads++; await delay(2); return h.workflow; };
  h.api.execution = async id => {
    active++; peak = Math.max(peak, active); await delay(id === '1' ? 12 : 4); active--;
    const source = structuredClone(h.sources['1']); source.id = id;
    source.data.resultData.runData.Webhook[0].data.main[0][0].json.id = id;
    return source;
  };
  const selection = parseSelection(workflowId, '1 2 3 4 5 6 7 8', config), progress = [];
  const preview = await h.bulk.preview(selection, rows => progress.push(rows.map(row => row.executionId)));
  assert.equal(peak, 4); assert.equal(active, 0); assert.equal(preview.runnable, true);
  assert.deepEqual(preview.rows.map(row => row.executionId), selection.map(ids => ids.executionId));
  assert.deepEqual(progress.map(rows => rows.length), [4, 8]);
  assert.equal(workflowReads, 3); // Two concurrent waves, then a fresh final read.
  assert.ok(userReads < 2 * selection.length); assert.equal(h.posts.length, 0); assert.equal(h.map.size, 0);
  const workflowReadsBeforeSubmit = workflowReads;
  const result = await h.bulk.submit(selection, true);
  assert.equal(result.reason, 'complete'); assert.equal(workflowReads - workflowReadsBeforeSubmit, 8);
  assert.deepEqual(h.posts.map(payload => payload.triggerToStartFrom.data.data.main[0][0].json.id), selection.map(ids => ids.executionId));
});

test('a fatal parallel preview waits for in-flight reads, clears approvals and does not launch another wave', async () => {
  const h = harness(); let started = 0, finished = 0;
  h.api.execution = async id => {
    started++; await new Promise(resolve => setTimeout(resolve, id === '1' ? 1 : 8)); finished++;
    if (id === '1') throw Object.assign(new Error(), {code: 'session_expired'});
    return {...structuredClone(h.sources['1']), id};
  };
  const selection = parseSelection(workflowId, '1 2 3 4 5 6', config);
  await assert.rejects(h.bulk.preview(selection), {code: 'session_expired'});
  assert.equal(started, 4); assert.equal(finished, 4);
  await assert.rejects(h.bulk.submit(selection, true), {code: 'preview_required'});
  assert.equal(h.posts.length, 0); assert.equal(h.map.size, 0);
});

test('batches above 50 require a separate explicit acknowledgement before any POST', async () => {
  const h = harness();
  h.api.execution = async id => {
    const source = structuredClone(h.sources['1']); source.id = id;
    source.data.resultData.runData.Webhook[0].data.main[0][0].json.id = id;
    return source;
  };
  const selection = parseSelection(workflowId, Array.from({length: 51}, (_, i) => i + 1).join(' '), config);
  assert.equal(selection.length, 51);
  assert.equal(parseSelection(workflowId, selection.map(ids => ids.executionId).join(' '), config, 'retry').length, 51);
  assert.equal((await h.bulk.preview(selection)).runnable, true);
  await assert.rejects(h.bulk.submit(selection, true), {code: 'large_batch_confirmation_required'});
  assert.equal(h.posts.length, 0); assert.equal(h.map.size, 0);
  await h.bulk.preview(selection);
  const result = await h.bulk.submit(selection, true, () => {}, true);
  assert.equal(result.reason, 'complete'); assert.equal(h.posts.length, 51);
  assert.equal(h.map.size, 51); assert.ok(result.rows.every(row => row.status === 'submitted'));
});
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
test('bulk replays subworkflow trigger sources into the child only', async () => {
  const h = harness();
  const name = 'When Executed by Another Workflow';
  const childConfig = {...config, workflows: {}};
  h.workflow.nodes = [{name, type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.2, parameters: {inputSource: 'passthrough'}}];
  for (const source of Object.values(h.sources)) {
    source.mode = 'integrated';
    source.data.parentExecution = {workflowId: 'parent', executionId: '99'};
    source.data.resultData.runData = {[name]: source.data.resultData.runData.Webhook};
  }
  const bulk = createBulkManager({...h.options, config: childConfig});
  const preview = await bulk.preview(h.selection);
  assert.equal(preview.runnable, true); assert.equal(h.posts.length, 0);
  const destinations = [];
  h.api.run = async (id, payload) => {destinations.push(id); h.posts.push(payload); return {executionId: String(100 + h.posts.length)};};
  const result = await bulk.submit(h.selection, true);
  assert.equal(result.reason, 'complete');
  assert.deepEqual(destinations, [workflowId, workflowId, workflowId]);
  assert.deepEqual(h.posts.map(p => p.triggerToStartFrom.data.data.main[0][0].json.id), ['1', '2', '3']);
  assert.ok(h.posts.every(p => p.triggerToStartFrom.name === name && Object.keys(p).length === 1));
  assert.ok(!JSON.stringify(h.posts).includes('parentExecution'));
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
