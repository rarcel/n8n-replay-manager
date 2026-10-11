import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../web/config.mjs';
import { prepareRetry } from '../web/model.mjs';
import { createManager, createApi } from '../web/client.mjs';
import { createBulkManager, parseSelection } from '../web/bulk.mjs';

const workflowId = 'child';
function harness() {
  const workflow = {id: workflowId, name: 'Retry fixture', versionId: 'current', scopes: ['workflow:read', 'workflow:execute'],
    nodes: [{name: 'Work', type: 'n8n-nodes-base.httpRequest', parameters: {url: 'https://example.invalid'}}], connections: {}, settings: {}};
  const source = id => ({id, workflowId, workflowData: {id: workflowId, versionId: 'old'}, status: 'error', finished: false, stoppedAt: '2026-10-11T12:00:00Z',
    data: {resultData: {lastNodeExecuted: 'Work', error: {message: 'fixture error'}, runData: {Work: [{error: {message: 'fixture error'}}]}},
      executionData: {nodeExecutionStack: [{node: structuredClone(workflow.nodes[0]), data: {main: [[{json: {id, privateValue: 'fixture only'}}]]}, source: null}]}}});
  const sources = {'1': source('1'), '2': source('2')}, map = new Map(), calls = []; let userId = 'user', time = 0;
  const storage = {getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k)};
  const locks = {request: async (key, options, callback) => callback({name: key})};
  const api = {user: async () => ({id: userId}), workflow: async () => workflow, execution: async id => sources[id],
    retry: async id => {
      assert.ok([...map.values()].some(raw => {const r = JSON.parse(raw); return r.sourceExecutionId === id && r.status === 'pending';}));
      calls.push({action: 'retry', id});
      const result = {id: String(100 + calls.length), retryOf: id, mode: 'retry', workflowId, status: 'success', stoppedAt: '2026-10-11T12:01:00Z'};
      sources[result.id] = result; return result;
    }, run: async () => {calls.push({action: 'run'}); return {executionId: '200'};}};
  const options = {api, storage, locks, config, now: () => time};
  return {workflow, sources, api, map, calls, options, manager: createManager(options), ids: {workflowId, executionId: '1', operation: 'retry'},
    setUser(value) {userId = value;}, setTime(value) {time = value;}};
}
test('retry previews without writes and submits only the source ID after confirmation and durable marker', async () => {
  const h = harness(); const before = structuredClone(h.sources['1']);
  const {plan} = await h.manager.preview(h.ids);
  assert.equal(plan.operation, 'retry'); assert.equal(plan.versionId, 'current'); assert.equal(plan.trigger, 'Work');
  assert.deepEqual(plan.payload, {loadWorkflow: true}); assert.equal(h.calls.length, 0); assert.equal(h.map.size, 0);
  await assert.rejects(h.manager.submit(h.ids, false), {code: 'preview_required'});
  await h.manager.preview(h.ids); const record = await h.manager.submit(h.ids, true);
  assert.equal(record.operation, 'retry'); assert.equal(record.executionId, '101'); assert.equal((await h.manager.check(h.ids)).status, 'success');
  assert.deepEqual(h.calls, [{action: 'retry', id: '1'}]); assert.deepEqual(h.sources['1'], before);
  assert.ok(![...h.map.values()].join('').includes('privateValue'));
  await h.manager.preview(h.ids); await assert.rejects(h.manager.submit(h.ids, true), {code: 'existing_reservation'});
  h.workflow.nodes.push({name: 'Start', type: 'n8n-nodes-base.webhook'});
  h.sources['1'].data.resultData.runData.Start = [{startTime: 1, executionTime: 1, data: {main: [[{json: {fixture: true}}]]}}];
  const replayIds = {workflowId, executionId: '1'};
  await h.manager.preview(replayIds);
  await assert.rejects(h.manager.submit(replayIds, true), {code: 'existing_reservation'});
  assert.equal(h.calls.length, 1);
});
test('retry refuses succeeded, waiting, missing state, changed nodes, redacted, binary, pins and repeated runs', () => {
  for (const change of [
    h => h.sources['1'].status = 'success', h => h.sources['1'].finished = true,
    h => delete h.sources['1'].stoppedAt, h => h.sources['1'].waitTill = '2026-10-12',
    h => delete h.sources['1'].workflowData, h => h.sources['1'].workflowData.id = 'other',
    h => delete h.sources['1'].data.executionData,
    h => h.sources['1'].data.executionData.nodeExecutionStack = [],
    h => h.workflow.nodes[0].name = 'Renamed', h => h.workflow.nodes[0].disabled = true,
    h => h.workflow.nodes[0].type = 'n8n-nodes-base.code', h => h.workflow.scopes = ['workflow:read'],
    h => delete h.workflow.versionId, h => h.workflow.pinData = {Work: []},
    h => h.sources['1'].data.resultData.pinData = {Work: []},
    h => h.sources['1'].data.redactionInfo = {isRedacted: true},
    h => h.sources['1'].data.executionData.nodeExecutionStack[0].data.main[0][0].binary = {},
    h => h.sources['1'].data.resultData.runData.Work.push({}),
  ]) {const h = harness(); change(h); assert.throws(() => prepareRetry(h.sources['1'], h.workflow, h.ids, config)); assert.equal(h.calls.length, 0);}
});
test('retry revalidates saved state, current definition, identity, mode and expiry before POST', async () => {
  for (const change of [
    h => h.sources['1'].data.executionData.nodeExecutionStack[0].data.main[0][0].json.changed = true,
    h => h.sources['1'].data.resultData.error.message = 'changed',
    h => h.workflow.settings = {changed: true}, h => h.workflow.versionId = 'new',
    h => h.setUser('other'), h => h.setTime(300001),
    h => h.ids.operation = 'replay',
  ]) {const h = harness(); await h.manager.preview(h.ids); change(h); await assert.rejects(h.manager.submit(h.ids, true)); assert.equal(h.calls.length, 0);}
});
test('retry requires locks and storage, preserves unknown response, and shares reservations with replay', async () => {
  for (const kind of ['storage', 'locks', 'lost', 'mismatch']) {
    const h = harness();
    if (kind === 'storage') h.options.storage.setItem = () => {throw new Error();};
    if (kind === 'locks') h.options.locks.request = undefined;
    if (kind === 'lost') h.api.retry = async () => {h.calls.push(1); throw new Error();};
    if (kind === 'mismatch') h.api.retry = async () => {h.calls.push(1); return {id: '101', workflowId: 'other', mode: 'retry', retryOf: '1'};};
    await h.manager.preview(h.ids); await assert.rejects(h.manager.submit(h.ids, true));
    assert.equal(h.calls.length, ['lost', 'mismatch'].includes(kind) ? 1 : 0);
    if (['lost', 'mismatch'].includes(kind)) {
      assert.equal((await h.manager.getRecord({...h.ids, operation: 'replay'})).status, 'unknown');
      await h.manager.preview(h.ids); await assert.rejects(h.manager.submit(h.ids, true), {code: 'existing_reservation'});
    }
  }
});
test('bulk retries sequentially, rejects mixed modes and stops on a returned failed retry', async () => {
  const h = harness(); const bulk = createBulkManager(h.options), selection = parseSelection(workflowId, '1 2', config, 'retry');
  assert.equal((await bulk.preview(selection)).runnable, true); assert.equal(h.calls.length, 0);
  await assert.rejects(bulk.submit(selection.map(ids => ({...ids, operation: 'replay'})), true), {code: 'preview_required'});
  await assert.rejects(bulk.preview([selection[0], {...selection[1], operation: 'replay'}]), {code: 'bulk_selection_invalid'});
  await bulk.preview(selection);
  const original = h.api.retry; h.api.retry = async id => ({...await original(id), status: 'error'});
  const result = await bulk.submit(selection, true);
  assert.equal(result.reason, 'retry_not_successful'); assert.equal(h.calls.length, 1);
  assert.deepEqual(result.rows.map(row => row.status), ['submitted', 'not_sent']);
});
test('retry API uses the native route, ambient session and current workflow without data or redaction override', async () => {
  let call; const api = createApi({origin: 'https://n8n.example', storage: {getItem: () => '00000000-0000-4000-8000-000000000001'}, fetchImpl: async (url, options) => {
    call = {url, options}; return new Response(JSON.stringify({data: {id: '100'}}), {headers: {'Content-Type': 'application/json'}});
  }});
  await api.retry('1'); assert.equal(call.url.pathname, '/rest/executions/1/retry'); assert.equal(call.url.search, '');
  assert.equal(call.options.method, 'POST'); assert.equal(call.options.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(call.options.body), {loadWorkflow: true});
  assert.equal(call.options.headers.Authorization, undefined); assert.equal(call.options.headers.Cookie, undefined);
  await assert.rejects(api.retry('../login'), {code: 'invalid_path'});
});
test('bulk retry succeeds sequentially and validates retry result provenance', async () => {
  const h = harness(), bulk = createBulkManager(h.options), selection = parseSelection(workflowId, '1 2', config, 'retry');
  await bulk.preview(selection); const result = await bulk.submit(selection, true);
  assert.equal(result.reason, 'complete'); assert.deepEqual(h.calls.map(call => call.id), ['1', '2']);
  assert.deepEqual(result.rows.map(row => row.status), ['submitted', 'submitted']);
  h.sources['101'].retryOf = 'wrong';
  await assert.rejects(h.manager.check(h.ids), {code: 'result_mismatch'});
  h.sources['101'].retryOf = '1'; h.sources['101'].mode = 'manual';
  await assert.rejects(h.manager.check(h.ids), {code: 'result_mismatch'});
});
