import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../web/config.mjs';
import { createApi } from '../web/client.mjs';
import { createExplorer, executionQuery, localDateToIso } from '../web/explorer.mjs';
const workflowId = 'fixture-workflow';
const row = id => ({id: String(id), workflowId, status: 'error', startedAt: '2026-10-10T12:00:00.000Z', stoppedAt: '2026-10-10T12:01:00.000Z', scopes: ['workflow:read', 'workflow:execute']});
const page = (rows, nextCursor = null) => ({results: rows, nextCursor, count: 100, estimated: false});

test('select all scans exact filters across pages without moving the display; page-only replaces other-page choices', async () => {
  const calls = [];
  const first = page([row(1), {...row(2), scopes: []}], 'next'), second = page([row(3)]);
  const explorer = createExplorer({config, api: {user: async () => ({id: 'u'}), executions: async filters => { calls.push(filters); return filters.cursor ? second : first; }}});
  await explorer.search({workflowId, status: 'error'});
  const displayed = explorer.page;
  assert.equal(await explorer.selectAll(), 2);
  assert.deepEqual(explorer.selection(), ['1', '3']); assert.equal(explorer.page, displayed);
  assert.deepEqual(calls.map(call => [call.status, call.cursor]), [['error', undefined], ['error', undefined], ['error', 'next']]);
  await explorer.more(); assert.deepEqual(explorer.selection(), ['1', '3']);
  explorer.selectPage(); assert.deepEqual(explorer.selection(), ['3']);
});

test('select all refuses a truncated selection above 50 and preserves previous choices', async () => {
  const explorer = createExplorer({config, api: {user: async () => ({id: 'u'}), executions: async filters => filters.cursor ? page([row(51)]) : page(Array.from({length: 50}, (_, i) => row(i + 1)), 'next')}});
  await explorer.search({workflowId}); explorer.select('1', true);
  await assert.rejects(explorer.selectAll(), {code: 'selection_limit'});
  assert.deepEqual(explorer.selection(), ['1']); assert.equal(explorer.page.rows.length, 50);
  explorer.selectPage(); assert.equal(explorer.selection().length, 50);
});

test('select all clears selection on changed session, repeated cursor, duplicate source or network failure', async () => {
  for (const issue of ['session', 'cursor', 'duplicate', 'network']) {
    let scans = 0;
    const explorer = createExplorer({config, api: {user: async () => ({id: issue === 'session' && scans > 1 ? 'other' : 'u'}), executions: async filters => {
      scans++;
      if (filters.cursor && issue === 'network') throw new Error('network');
      return filters.cursor ? page([row(issue === 'duplicate' ? 1 : 2)], issue === 'cursor' ? 'next' : null) : page([row(1)], 'next');
    }}});
    await explorer.search({workflowId}); explorer.select('1', true);
    await assert.rejects(explorer.selectAll()); assert.deepEqual(explorer.selection(), []); assert.equal(explorer.page, null);
  }
});
function harness() {
  const calls = []; let userId = 'u'; let response = page([row(1)], 'opaque_cursor');
  const api = {user: async () => ({id: userId}), executions: async filters => { calls.push(filters); return response; }};
  return {explorer: createExplorer({api, config}), calls, setPage(value) {response = value;}, setUser(value) {userId = value;}};
}
test('execution query uses status array, inclusive UTC date filters and opaque cursor, never legacy IDs', () => {
  const query = executionQuery({workflowId, status: 'error', startedAfter: '2026-10-10T14:00:00+02:00', startedBefore: '2026-10-11T00:00:00Z', cursor: 'opaque_cursor'});
  assert.deepEqual(JSON.parse(query.get('filter')), {workflowId, status: ['error'], startedAfter: '2026-10-10T12:00:00.000Z', startedBefore: '2026-10-11T00:00:00.000Z'});
  assert.equal(query.get('cursor'), 'opaque_cursor'); assert.equal(query.get('limit'), '50');
  assert.ok(!query.has('firstId') && !query.has('lastId'));
  assert.deepEqual(JSON.parse(executionQuery({workflowId}).get('filter')).status, ['success', 'error']);
  for (const filters of [{workflowId: '../login'}, {workflowId, status: 'running'}, {workflowId, startedAfter: 'bad'}, {workflowId, startedAfter: '2026-10-12T00:00:00Z', startedBefore: '2026-10-11T00:00:00Z'}, {workflowId, cursor: 'a&redactExecutionData=false'}]) assert.throws(() => executionQuery(filters));
  assert.equal(localDateToIso(''), undefined);
  assert.equal(localDateToIso('2026-10-10T14:00'), new Date('2026-10-10T14:00').toISOString());
  assert.throws(() => localDateToIso('invalid'), {code: 'invalid_filter'});
});
test('pagination preserves explicit selection and exact filters, reset clears all choices', async () => {
  const h = harness(); const filters = {workflowId, status: 'error', startedAfter: '2026-10-10T12:00:00Z'};
  await h.explorer.search(filters); h.explorer.select('1', true);
  filters.status = 'success';
  h.setPage(page([row(2)])); await h.explorer.more(); h.explorer.select('2', true);
  assert.deepEqual(h.explorer.selection(), ['1', '2']);
  assert.equal(h.calls[1].cursor, 'opaque_cursor'); assert.equal(h.calls[1].status, 'error');
  h.explorer.select('1', false); assert.deepEqual(h.explorer.selection(), ['2']);
  h.explorer.reset(); assert.deepEqual(h.explorer.selection(), []);
  await assert.rejects(h.explorer.more());
});
test('selection is explicit, maximum 50, ineligible summaries remain unavailable', async () => {
  const h = harness(); h.setPage(page(Array.from({length: 50}, (_, i) => row(i + 1)), 'next'));
  await h.explorer.search({workflowId}); assert.deepEqual(h.explorer.selection(), []);
  for (let i = 1; i <= 50; i++) h.explorer.select(String(i), true);
  h.setPage(page([row(51), {...row(52), stoppedAt: null}, {...row(53), scopes: []}, {...row(54), id: 'uuid-not-supported'}]));
  const result = await h.explorer.more();
  assert.deepEqual(result.rows.map(r => r.selectable), [true, false, false, false]);
  for (const id of ['51', '52', '53', 'uuid-not-supported', 'unknown']) assert.throws(() => h.explorer.select(id, true));
  h.explorer.select('1', false); h.explorer.select('51', true); assert.equal(h.explorer.selection().length, 50);
});
test('changed account, repeated cursors or rows and inconsistent responses discard selection', async () => {
  for (const change of ['user', 'cursor', 'duplicate', 'workflow', 'date', 'schema']) {
    const h = harness(); await h.explorer.search({workflowId, startedAfter: '2026-10-10T12:00:00Z'}); h.explorer.select('1', true);
    if (change === 'user') h.setUser('other');
    if (change === 'cursor') h.setPage(page([row(2)], 'opaque_cursor'));
    if (change === 'duplicate') h.setPage(page([row(1)]));
    if (change === 'workflow') h.setPage(page([{...row(2), workflowId: 'other'}]));
    if (change === 'date') h.setPage(page([{...row(2), startedAt: '2026-10-09T12:00:00Z'}]));
    if (change === 'schema') h.setPage({results: [row(2)]});
    await assert.rejects(h.explorer.more());
    assert.deepEqual(h.explorer.selection(), []); assert.equal(h.explorer.page, null);
  }
});
test('execution list requests are read-only same-origin with bounded query and no redaction override', async () => {
  let call;
  const api = createApi({storage: {getItem: () => '00000000-0000-4000-8000-000000000001'}, origin: 'https://n8n.example', fetchImpl: async (url, options) => {
    call = {url, options}; return new Response(JSON.stringify({data: page([row(1)])}), {headers: {'Content-Type': 'application/json'}});
  }});
  await api.executions({workflowId, status: 'error', cursor: 'opaque_cursor'});
  assert.equal(call.url.pathname, '/rest/executions'); assert.equal(call.url.origin, 'https://n8n.example');
  assert.equal(call.options.method, 'GET'); assert.equal(call.options.credentials, 'same-origin');
  assert.equal(call.options.headers.Cookie, undefined); assert.equal(call.options.body, undefined);
  assert.ok(!call.url.toString().includes('redactExecutionData'));
});
