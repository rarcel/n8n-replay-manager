import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../web/config.mjs';
import { createApi } from '../web/client.mjs';
import { workflowPage } from '../web/catalog.mjs';

const workflow = {id: 'fixture-workflow', name: '<b>Nom reçu</b>', scopes: ['workflow:read', 'workflow:execute']};
test('workflow catalogue respects configuration, scopes, archive and response pagination', async () => {
  const api = {user: async () => ({id: 'u'}), workflows: async () => ({count: 105, data: [workflow, {...workflow, id: 'other'}, {...workflow, scopes: ['workflow:read']}, {...workflow, isArchived: true}]})};
  const page = await workflowPage(api, {...config, discoverWorkflows: false, workflows: {'fixture-workflow': {trigger: 'Webhook'}}}, 100);
  assert.deepEqual(page.workflows.map(w => w.selectable), [true, false, false, false]);
  assert.equal(page.workflows[0].name, '<b>Nom reçu</b>');
  assert.equal(page.nextSkip, 104);
  api.workflows = async () => ({count: 105, data: [workflow]});
  assert.equal((await workflowPage(api, config, 104)).nextSkip, null);
});
test('workflow catalogue refuses changed account and incompatible envelopes', async () => {
  let count = 0;
  const api = {user: async () => ({id: String(count++)}), workflows: async () => ({data: [workflow], count: 1})};
  await assert.rejects(workflowPage(api, config), {code: 'session_changed'});
  api.user = async () => ({id: 'u'});
  for (const response of [{data: []}, {data: [null], count: 1}, {data: [ {...workflow, scopes: undefined}], count: 1}]) {
    api.workflows = async () => response;
    await assert.rejects(workflowPage(api, config), {code: 'invalid_response'});
  }
});
test('workflow listing preserves top-level count and sends bounded read-only query with ambient session', async () => {
  let call;
  const api = createApi({storage: {getItem: () => '00000000-0000-4000-8000-000000000001'}, origin: 'https://n8n.example', fetchImpl: async (url, options) => {
    call = {url, options};
    return new Response(JSON.stringify({count: 110, data: [workflow]}), {headers: {'Content-Type': 'application/json'}});
  }});
  assert.equal((await api.workflows({skip: 100})).count, 110);
  assert.equal(call.url.pathname, '/rest/workflows');
  assert.deepEqual(Object.fromEntries(call.url.searchParams), {take: '100', skip: '100', includeScopes: 'true'});
  assert.equal(call.options.method, 'GET');
  assert.equal(call.options.credentials, 'same-origin');
  assert.throws(() => api.workflows({skip: -1}), {code: 'invalid_filter'});
});
test('workflow name search encodes text safely and preserves server pagination', async () => {
  const calls = [];
  const api = createApi({storage: {getItem: () => '00000000-0000-4000-8000-000000000001'}, origin: 'https://n8n.example', fetchImpl: async (url, options) => {
    calls.push({url, options});
    return new Response(JSON.stringify({count: 101, data: [workflow]}), {headers: {'Content-Type': 'application/json'}});
  }});
  await api.workflows({name: '  Factures <test> & clients  ', skip: 100});
  assert.deepEqual(JSON.parse(calls[0].url.searchParams.get('filter')), {query: 'Factures <test> & clients'});
  assert.equal(calls[0].url.searchParams.get('skip'), '100');
  assert.equal(calls[0].options.method, 'GET');
  await api.workflows({name: '   '});
  assert.equal(calls[1].url.searchParams.has('filter'), false);
  for (const name of [null, 42, 'x'.repeat(201)]) assert.throws(() => api.workflows({name}), {code: 'invalid_filter'});
  const pages = [];
  const stub = {user: async () => ({id: 'u'}), workflows: async query => {pages.push(query); return {count: 101, data: [workflow]};}};
  const page = await workflowPage(stub, config, 0, 'Factures');
  await workflowPage(stub, config, page.nextSkip, 'Factures');
  assert.deepEqual(pages, [{skip: 0, name: 'Factures'}, {skip: 1, name: 'Factures'}]);
});
