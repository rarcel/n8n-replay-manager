import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stringify } from '../web/vendor/flatted.mjs';
import { config } from '../web/config.mjs';
import { ReplayError, prepareReplay, normalizeExecution, digestPlan } from '../web/model.mjs';
import { createApi, createManager, readBrowserId } from '../web/client.mjs';
import { parseSelection, prepareSelection } from '../web/bulk.mjs';
const ids = {workflowId: config.defaultWorkflowId, executionId: config.defaultExecutionId};
test('bulk requires explicit unique IDs, one workflow, and bounded selection', async () => {
  assert.equal(parseSelection(ids.workflowId, '1, 2;\n3', config).length, 3);
  for (const value of ['', '1 1', 'abc', Array.from({length: 51}, (_, i) => i + 1).join(' ')]) {
    assert.throws(() => parseSelection(ids.workflowId, value, config));
  }
  const h = harness();
  await assert.rejects(prepareSelection({...h, storage: h.store, config, selection: [ids, {...ids, workflowId: 'other'}]}), {code: 'bulk_selection_invalid'});
  assert.deepEqual(h.calls, []);
});

test('bulk checks sources individually and returns metadata only without POST or persistence', async () => {
  const h = harness();
  h.api.execution = async id => {
    const execution = structuredClone(h.f.execution); execution.id = id;
    if (id === '2') execution.data.redactionInfo = {isRedacted: true};
    return execution;
  };
  const progress = [];
  const rows = await prepareSelection({selection: parseSelection(ids.workflowId, '1 2 3', config), api: h.api, storage: h.store, locks: locks(), config, onProgress: rows => progress.push(rows.length)});
  assert.deepEqual(rows.map(row => row.code), ['compatible', 'redacted_data', 'compatible']);
  assert.deepEqual(progress, [1, 2, 3]);
  assert.equal(h.store.map.size, 1);
  assert.ok(!h.calls.some(call => typeof call === 'object'));
  assert.ok(!JSON.stringify(rows).includes('order'));
  assert.ok(!JSON.stringify(rows).includes('payload'));
});

test('bulk aborts if identity or current definition changes during preparation', async () => {
  for (const change of ['identity', 'definition']) {
    const h = harness();
    h.api.execution = async id => ({...h.f.execution, id});
    await assert.rejects(prepareSelection({selection: parseSelection(ids.workflowId, '1 2', config), api: h.api, storage: h.store, locks: locks(), config, onProgress: () => {
      if (change === 'identity') h.setUser({id: 'other'});
      else h.f.workflow.settings = {changed: true};
    }}), {code: change === 'identity' ? 'session_changed' : 'preview_changed'});
    assert.ok(!h.calls.some(call => typeof call === 'object'));
  }
});
function storage() {
  const map = new Map([['n8n-browserId', '00000000-0000-4000-8000-000000000001']]);
  return {getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key), map};
}
function locks() {
  const active = new Set();
  return {async request(key, options, callback) {
    if (active.has(key)) return callback(null);
    active.add(key); try { return await callback({name: key}); } finally { active.delete(key); }
  }};
}
function fixtures() {
  return {
    execution: {id: ids.executionId, workflowId: ids.workflowId, status: 'success', finished: true, mode: 'webhook', stoppedAt: '2026-10-10T12:00:00Z', workflowData: {versionId: 'v1'}, data: {resultData: {runData: {Webhook: [{startTime: 1791633600000, executionTime: 12, executionStatus: 'success', data: {main: [[{json: {body: {order: 42}}, pairedItem: {item: 0}}]]}}]}}}},
    workflow: {id: ids.workflowId, name: 'Workflow de test', versionId: 'v1', scopes: ['workflow:read', 'workflow:execute'], nodes: [{name: 'Webhook', type: 'n8n-nodes-base.webhook'}]},
  };
}
function harness(options = {}) {
  const f = fixtures(), calls = [], store = options.storage ?? storage();
  let user = {id: 'user-1', firstName: 'Test'};
  const api = {user: async () => {calls.push('user'); return user;}, execution: async () => {calls.push('execution'); return f.execution;}, workflow: async () => {calls.push('workflow'); return f.workflow;}, run: async (workflowId, payload) => {calls.push({workflowId, payload}); return {executionId: '100'};}, ...options.api};
  const manager = createManager({api, storage: store, locks: options.locks ?? locks(), config});
  return {f, calls, store, api, manager, setUser(value) { user = value; }};
}
test('normalizes editor flatted data, preserving reference sharing', () => {
  const f = fixtures(); const shared = {value: 12}; f.execution.data.extra = {a: shared, b: shared};
  f.execution.data = stringify(f.execution.data);
  const normalized = normalizeExecution(f.execution);
  assert.equal(normalized.data.extra.a, normalized.data.extra.b);
  assert.equal(prepareReplay(f.execution, f.workflow, ids, config).itemCount, 1);
});
test('discovers recorded schedule and manual trigger outputs in accessible workflows', async () => {
  for (const type of ['n8n-nodes-base.scheduleTrigger', 'n8n-nodes-base.manualTrigger']) {
    const h = harness(); const selected = {workflowId: 'discovered', executionId: ids.executionId};
    h.f.workflow.id = selected.workflowId; h.f.execution.workflowId = selected.workflowId;
    h.f.workflow.nodes = [{name: 'Start', type}];
    h.f.execution.data.resultData.runData.Start = h.f.execution.data.resultData.runData.Webhook;
    delete h.f.execution.data.resultData.runData.Webhook;
    const {plan} = await h.manager.preview(selected);
    assert.equal(plan.trigger, 'Start'); assert.equal(plan.triggerType, type);
    assert.equal(plan.payload.triggerToStartFrom.data.data.main[0][0].json.body.order, 42);
    await h.manager.submit(selected, true);
    assert.equal(h.calls.filter(c => typeof c === 'object').length, 1);
  }
});
function subworkflowHarness(parameters = {inputSource: 'passthrough'}) {
  const h = harness();
  const selected = {workflowId: 'child', executionId: ids.executionId};
  const name = 'When Executed by Another Workflow';
  h.f.workflow.id = selected.workflowId; h.f.execution.workflowId = selected.workflowId;
  h.f.execution.mode = 'integrated';
  h.f.workflow.nodes = [{name, type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.2, parameters}];
  h.f.execution.workflowData.nodes = structuredClone(h.f.workflow.nodes);
  const task = h.f.execution.data.resultData.runData.Webhook[0];
  task.data.main = [[{json: {order: 42, nested: {values: [1, true, null]}}, pairedItem: {item: 7}}, {json: {order: 43}}]];
  task.source = [{previousNode: 'Parent'}];
  task.metadata = {parentExecution: {workflowId: 'parent', executionId: '99'}};
  h.f.execution.data.parentExecution = {workflowId: 'parent', executionId: '99'};
  h.f.execution.data.resultData.runData = {[name]: [task]};
  return {...h, selected, name, task};
}
test('subworkflow trigger replays recorded JSON independently with exact ITaskData and explicit confirmation', async () => {
  for (const parameters of [{inputSource: 'passthrough'}, {inputSource: 'workflowInputs', workflowInputs: {values: [{name: 'order', type: 'number'}]}}]) {
    const h = subworkflowHarness(parameters); const before = structuredClone(h.f);
    const {plan} = await h.manager.preview(h.selected);
    assert.equal(plan.triggerType, 'n8n-nodes-base.executeWorkflowTrigger');
    assert.equal(plan.itemCount, 2);
    assert.deepEqual(plan.payload.triggerToStartFrom.data.data.main, [[{json: {order: 42, nested: {values: [1, true, null]}}}, {json: {order: 43}}]]);
    assert.equal(plan.payload.triggerToStartFrom.data.main, undefined);
    assert.deepEqual(plan.payload.triggerToStartFrom.data.source, []);
    assert.deepEqual(Object.keys(plan.payload), ['triggerToStartFrom']);
    assert.equal(plan.payload.triggerToStartFrom.data.metadata, undefined);
    await assert.rejects(h.manager.submit(h.selected, false), {code: 'preview_required'});
    assert.equal(h.calls.filter(c => typeof c === 'object').length, 0);
    await h.manager.preview(h.selected);
    await h.manager.submit(h.selected, true);
    const posts = h.calls.filter(c => typeof c === 'object');
    assert.equal(posts.length, 1); assert.equal(posts[0].workflowId, 'child');
    assert.deepEqual(h.f, before);
    assert.ok(![...h.store.map.values()].join('').includes('nested'));
  }
});
test('subworkflow trigger refuses unsafe source data and incompatible current trigger', async () => {
  for (const change of [
    h => { h.task.data.main[0][0].binary = {}; },
    h => { h.task.data.main[0][0].redaction = {redacted: true}; },
    h => { h.f.execution.data.resultData.runData[h.name].push(structuredClone(h.task)); },
    h => { h.f.workflow.nodes[0].disabled = true; },
    h => { h.f.execution.workflowData.nodes[0].type = 'n8n-nodes-base.manualTrigger'; },
    h => { h.f.workflow.nodes.push({name: 'Other', type: 'n8n-nodes-base.manualTrigger'}); h.f.execution.data.resultData.runData.Other = [h.task]; },
  ]) {
    const h = subworkflowHarness(); change(h);
    await assert.rejects(h.manager.preview(h.selected));
    assert.equal(h.calls.filter(c => typeof c === 'object').length, 0);
  }
});
test('subworkflow trigger input schema or source change after preview blocks POST', async () => {
  for (const change of [h => { h.f.workflow.nodes[0].parameters = {inputSource: 'workflowInputs', workflowInputs: {values: [{name: 'other', type: 'string'}]}}; }, h => { h.task.data.main[0][0].json.order = 99; }]) {
    const h = subworkflowHarness(); await h.manager.preview(h.selected); change(h);
    await assert.rejects(h.manager.submit(h.selected, true), {code: 'preview_changed'});
    assert.equal(h.calls.filter(c => typeof c === 'object').length, 0);
  }
});
test('discovery refuses ambiguous triggers, historical type changes and unsupported contexts', () => {
  const selected = {workflowId: 'discovered', executionId: ids.executionId};
  const base = () => { const f = fixtures(); f.workflow.id = selected.workflowId; f.execution.workflowId = selected.workflowId; return f; };
  for (const change of [
    f => { f.workflow.nodes.push({name: 'Other', type: 'n8n-nodes-base.manualTrigger'}); f.execution.data.resultData.runData.Other = f.execution.data.resultData.runData.Webhook; },
    f => { f.execution.workflowData.nodes = [{name: 'Webhook', type: 'n8n-nodes-base.scheduleTrigger'}]; },
    f => { f.workflow.nodes[0].type = '@n8n/n8n-nodes-langchain.chatTrigger'; },
    f => { f.workflow.nodes[0].type = 'n8n-nodes-base.errorTrigger'; },
  ]) { const f = base(); change(f); assert.throws(() => prepareReplay(f.execution, f.workflow, selected, config)); }
  const f = base(); assert.throws(() => prepareReplay(f.execution, f.workflow, selected, {...config, discoverWorkflows: false}), {code: 'workflow_not_configured'});
});
test('constructs only known-trigger JSON payload and never mutates source', () => {
  const f = fixtures(); const before = structuredClone(f);
  const plan = prepareReplay(f.execution, f.workflow, ids, config);
  assert.deepEqual(plan.payload, {triggerToStartFrom: {name: 'Webhook', data: {startTime: 1791633600000, executionTime: 12, executionStatus: 'success', source: [], data: {main: [[{json: {body: {order: 42}}}]]}}}});
  assert.equal(plan.payload.triggerToStartFrom.data.data.main[0][0].json.body.order, 42);
  assert.equal(plan.payload.triggerToStartFrom.data.main, undefined);
  assert.deepEqual(f, before);
});
test('rejects wrong workflow, permissions, version, pins and trigger', () => {
  const changes = [f => f.execution.workflowId = 'other', f => f.workflow.scopes = ['workflow:read'], f => delete f.workflow.versionId, f => f.workflow.pinData = {Other: []}, f => f.workflow.nodes[0].disabled = true, f => f.workflow.nodes[0].type = 'n8n-nodes-base.code'];
  for (const change of changes) { const f = fixtures(); change(f); assert.throws(() => prepareReplay(f.execution, f.workflow, ids, config)); }
});
test('replays into current workflow with missing or different historical version', async () => {
  for (const field of ['source', 'different']) {
    const h = harness();
    if (field === 'source') delete h.f.execution.workflowData;
    else h.f.workflow.versionId = 'v2';
    const {plan} = await h.manager.preview(ids);
    assert.equal(plan.replayTarget, 'current');
    assert.equal(plan.versionId, h.f.workflow.versionId);
    assert.ok(!h.calls.some(c => typeof c === 'object'));
    await h.manager.submit(ids, true);
    const posts = h.calls.filter(c => typeof c === 'object');
    assert.equal(posts.length, 1);
    assert.deepEqual(Object.keys(posts[0].payload), ['triggerToStartFrom']);
  }
  const h = harness(); delete h.f.workflow.versionId;
  await assert.rejects(h.manager.preview(ids), {code: 'workflow_version_unavailable'});
  assert.ok(!h.calls.some(c => typeof c === 'object'));
});
test('stored debug pins block manual replay before any POST without modifying workflow', async () => {
  for (const name of ['Webhook', 'Downstream']) {
    const h = harness();
    h.f.workflow.pinData = {[name]: [{json: {debug: 'replacement'}}]};
    const before = structuredClone(h.f.workflow);
    await assert.rejects(h.manager.preview(ids), {code: 'pinned_data'});
    assert.deepEqual(h.f.workflow, before);
    assert.equal(h.calls.filter(c => typeof c === 'object').length, 0);
  }
  const h = harness(); await h.manager.preview(ids);
  h.f.workflow.pinData = {Webhook: [{json: {debug: 'added after preview'}}]};
  await assert.rejects(h.manager.submit(ids, true), {code: 'pinned_data'});
  assert.equal(h.calls.filter(c => typeof c === 'object').length, 0);
});
test('blocks changes to current version or definition after preview without POST', async () => {
  for (const change of [f => f.workflow.versionId = 'v2', f => f.workflow.nodes[0].parameters = {path: 'changed'}, f => f.workflow.connections = {Webhook: {main: []}}, f => f.workflow.settings = {executionOrder: 'v1'}]) {
    const h = harness(); await h.manager.preview(ids); change(h.f);
    await assert.rejects(h.manager.submit(ids, true), {code: 'preview_changed'});
    assert.ok(!h.calls.some(c => typeof c === 'object'));
  }
});
test('refuses binary, redacted, unavailable and ambiguous source data', () => {
  const changes = [f => f.execution.data.redactionInfo = {isRedacted: true}, f => f.execution.data.resultData.runData.Webhook[0].data.main[0][0].redaction = {redacted: true}, f => f.execution.data.resultData.runData.Webhook[0].data.main[0][0].binary = {}, f => f.execution.data.resultData.runData.Webhook.push({}), f => f.execution.dataTooLargeToDisplay = true, f => f.execution.data = 'not flatted', f => f.execution.data.resultData.runData.Webhook[0].data.main = [], f => f.execution.status = 'waiting'];
  for (const change of changes) { const f = fixtures(); change(f); assert.throws(() => prepareReplay(f.execution, f.workflow, ids, config)); }
});
test('terminal errors with finished=false remain eligible when stoppedAt exists', () => {
  const f = fixtures(); f.execution.status = 'error'; f.execution.finished = false;
  assert.equal(prepareReplay(f.execution, f.workflow, ids, config).itemCount, 1);
  delete f.execution.stoppedAt;
  assert.throws(() => prepareReplay(f.execution, f.workflow, ids, config), {code: 'source_not_terminal'});
});
test('simulation only reads and persists no payload', async () => {
  const h = harness(); await h.manager.preview(ids);
  assert.deepEqual(h.calls, ['user', 'execution', 'workflow', 'user']);
  assert.equal(h.store.map.size, 1);
});
test('submit requires preview and explicit confirmation', async () => {
  const h = harness(); await assert.rejects(h.manager.submit(ids, true), {code: 'preview_required'});
  await h.manager.preview(ids); await assert.rejects(h.manager.submit(ids, false), {code: 'preview_required'});
  assert.ok(!h.calls.some(c => typeof c === 'object'));
});
test('revalidates and reserves before one submission; new manager cannot repeat it', async () => {
  const h = harness(); await h.manager.preview(ids); const result = await h.manager.submit(ids, true);
  assert.equal(result.executionId, '100'); assert.equal(h.calls.filter(c => typeof c === 'object').length, 1);
  const values = [...h.store.map.values()].join(''); assert.ok(!values.includes('order')); assert.ok(!values.includes('triggerToStartFrom'));
  const next = harness({storage: h.store}); await next.manager.preview(ids);
  await assert.rejects(next.manager.submit(ids, true), {code: 'existing_reservation'});
  assert.ok(!next.calls.some(c => typeof c === 'object'));
});
test('source change after preview refuses POST', async () => {
  const h = harness(); await h.manager.preview(ids);
  h.f.execution.data.resultData.runData.Webhook[0].data.main[0][0].json.body.order = 99;
  await assert.rejects(h.manager.submit(ids, true), {code: 'preview_changed'});
  assert.ok(!h.calls.some(c => typeof c === 'object'));
});
test('changed account and revoked execution permission refuse POST', async () => {
  const h = harness(); await h.manager.preview(ids); h.setUser({id: 'user-2'});
  await assert.rejects(h.manager.submit(ids, true), {code: 'session_changed'});
  const second = harness(); await second.manager.preview(ids); second.f.workflow.scopes = ['workflow:read'];
  await assert.rejects(second.manager.submit(ids, true), {code: 'workflow_scope_missing'});
});
test('lost response preserves unknown record and no automatic retry', async () => {
  let count = 0; const h = harness({api: {run: async () => {count++; throw new ReplayError('outcome_unknown');}}});
  await h.manager.preview(ids); await assert.rejects(h.manager.submit(ids, true), {code: 'outcome_unknown'});
  assert.equal((await h.manager.getRecord(ids)).status, 'unknown');
  await h.manager.preview(ids); await assert.rejects(h.manager.submit(ids, true), {code: 'existing_reservation'}); assert.equal(count, 1);
});
test('waitingForWebhook never reports successful submission', async () => {
  const h = harness({api: {run: async () => ({waitingForWebhook: true})}});
  await h.manager.preview(ids); await assert.rejects(h.manager.submit(ids, true), {code: 'waiting_for_webhook'});
  assert.equal((await h.manager.getRecord(ids)).status, 'waitingForWebhook');
});
test('cross-tab lock blocks overlapping submissions', async () => {
  const sharedStore = storage(), sharedLocks = locks(); let release, started;
  const entry = new Promise(r => {started = r;}); const gate = new Promise(r => {release = r;});
  const first = harness({storage: sharedStore, locks: sharedLocks, api: {run: async () => {started(); await gate; return {executionId: '100'};}}});
  const second = harness({storage: sharedStore, locks: sharedLocks});
  await first.manager.preview(ids); await second.manager.preview(ids);
  const pending = first.manager.submit(ids, true); await entry;
  await assert.rejects(second.manager.submit(ids, true), {code: 'another_tab_busy'});
  release(); await pending;
});
test('failed local reservation and unavailable locks prevent POST', async () => {
  const store = storage(); store.setItem = () => {throw new Error();};
  const h = harness({storage: store}); await h.manager.preview(ids);
  await assert.rejects(h.manager.submit(ids, true), {code: 'storage_unavailable'});
  assert.ok(!h.calls.some(c => typeof c === 'object'));
  const other = harness(); const manager = createManager({api: other.api, storage: other.store, locks: {}, config});
  await manager.preview(ids); await assert.rejects(manager.submit(ids, true), {code: 'locks_unavailable'});
});
test('release requires explicit acknowledgement and a new preview', async () => {
  const h = harness(); await h.manager.preview(ids); await h.manager.submit(ids, true);
  await assert.rejects(h.manager.release(ids, false), {code: 'acknowledgement_required'});
  await h.manager.release(ids, true); assert.equal(await h.manager.getRecord(ids), null);
  await assert.rejects(h.manager.submit(ids, true), {code: 'preview_required'});
});
test('result verification checks execution ID, workflow and manual mode', async () => {
  const h = harness(); await h.manager.preview(ids); await h.manager.submit(ids, true);
  await assert.rejects(h.manager.check(ids), {code: 'result_mismatch'});
  h.api.execution = async () => ({id: '100', workflowId: ids.workflowId, mode: 'manual', status: 'success', finished: true, stoppedAt: '2026-10-11T12:00:00Z'});
  assert.equal((await h.manager.check(ids)).status, 'success');
});
test('API uses ambient session, exact browser-id, no Cookie or API key', async () => {
  const store = storage(), calls = [];
  const api = createApi({storage: store, origin: 'https://n8n.example', fetchImpl: async (url, options) => { calls.push({url: String(url), ...options}); return new Response(JSON.stringify({data: {id: 'test'}}), {headers: {'Content-Type': 'application/json'}}); }});
  await api.user(); await api.execution(ids.executionId); await api.run(ids.workflowId, {triggerToStartFrom: {name: 'Webhook'}});
  assert.ok(calls.every(c => c.credentials === 'same-origin' && c.redirect === 'error' && c.cache === 'no-store'));
  assert.ok(calls.every(c => c.headers['browser-id'] === store.getItem('n8n-browserId')));
  assert.ok(calls.every(c => c.headers.Cookie === undefined && c.headers.Authorization === undefined && c.headers['X-N8N-API-KEY'] === undefined));
  assert.equal(calls[0].method, 'GET'); assert.equal(calls[2].method, 'POST');
  await assert.rejects(api.execution('../login'), {code: 'invalid_path'});
  assert.equal(calls.length, 3);
});
test('browser-id must already exist; identifier is never regenerated', () => {
  const store = storage(); store.removeItem('n8n-browserId');
  assert.throws(() => readBrowserId(store), {code: 'open_editor_first'}); assert.equal(store.map.size, 0);
});
test('denied, expired, HTML and malformed responses fail closed', async () => {
  const cases = [
    [new Response('', {status: 401}), 'session_expired'], [new Response('', {status: 403}), 'access_denied'],
    [new Response('<html>', {headers: {'Content-Type': 'text/html'}}), 'invalid_response'],
    [new Response('{}', {headers: {'Content-Type': 'application/json'}}), 'invalid_response'],
  ];
  for (const [response, code] of cases) {
    const api = createApi({storage: storage(), origin: 'https://n8n.example', fetchImpl: async () => response});
    await assert.rejects(api.user(), {code});
  }
});
test('digest distinguishes payload and version, and rejects oversized trigger JSON', async () => {
  const f = fixtures(); const plan = prepareReplay(f.execution, f.workflow, ids, config);
  assert.notEqual(await digestPlan(plan), await digestPlan({...plan, versionId: 'v2'}));
  f.execution.data.resultData.runData.Webhook[0].data.main[0][0].json.body = 'x'.repeat(2 * 1024 * 1024);
  assert.throws(() => prepareReplay(f.execution, f.workflow, ids, config), {code: 'payload_too_large'});
});
test('deployment has unchanged official n8n image and no secrets or service gateway', () => {
  const compose = readFileSync('compose.yaml', 'utf8');
  assert.ok(compose.includes('docker.n8n.io/n8nio/n8n:2.42.4'));
  assert.ok(!compose.includes('secrets:') && !compose.includes('API_KEY') && !compose.includes('EDITOR_COOKIE'));
  const nginx = readFileSync('deploy/nginx.conf', 'utf8'); assert.ok(nginx.includes('location ^~ /replay-manager/')); assert.ok(nginx.includes('frame-ancestors'));
});
