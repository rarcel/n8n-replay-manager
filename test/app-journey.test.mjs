import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('page reset clears the entire journey and confirmations while preserving local markers', async t => {
  class Element {
    children = []; events = {}; attributes = {}; dataset = {}; value = ''; hidden = false; checked = false;
    classList = {toggle() {}};
    addEventListener(name, fn) { this.events[name] = fn; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    append(child) { this.children.push(child); }
    replaceChildren() { this.children = []; }
    focus() {}
    scrollIntoView() {}
  }
  const html = readFileSync('web/index.html', 'utf8'), elements = new Map();
  for (const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const element = new Element(); element.hidden = /\bhidden\b/.test(match[0]); elements.set(match[1], element);
  }
  const $ = id => elements.get(id), steps = [new Element(), new Element(), new Element()];
  $('operation-mode').value = 'replay'; $('filter-status').value = 'terminal';
  $('workflow-picker').parentElement = new Element();
  $('execution-filters').reset = () => {
    $('operation-mode').value = 'replay'; $('filter-status').value = 'terminal';
    $('filter-after').value = ''; $('filter-before').value = '';
  };
  const storage = new Map([['n8n-browserId', 'fixture-browser-id-123456'], ['replay-manager:v2:previous', 'marker']]);
  const globals = ['document', 'window', 'navigator', 'localStorage', 'location', 'matchMedia', 'addEventListener', 'fetch'];
  const previous = globals.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  t.after(() => globals.forEach((name, index) => previous[index] ? Object.defineProperty(globalThis, name, previous[index]) : delete globalThis[name]));
  Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {language: 'de-DE'}});
  Object.assign(globalThis, {
    document: {body: new Element(), getElementById: $, createElement: () => new Element(), querySelectorAll: selector => selector === '.steps li' ? steps : []},
    window: {location: {assign() { throw new Error('unexpected navigation'); }}},
    location: {origin: 'https://fixture.invalid'}, localStorage: {getItem: key => storage.get(key) ?? null},
    matchMedia: () => ({matches: false, addEventListener() {}}), addEventListener() {},
    fetch: async url => new Response(JSON.stringify(url.pathname === '/rest/login' ? {data: {id: 'user'}} : url.pathname === '/rest/executions' ? {data: {results: [{id: '101', workflowId: 'wf', status: 'error', startedAt: '2026-10-10T10:00:00Z', stoppedAt: '2026-10-10T10:01:00Z', scopes: ['workflow:read', 'workflow:execute']}], count: 1, estimated: false, nextCursor: null}} : {data: [], count: 0}), {headers: {'content-type': 'application/json'}}),
  });
  await import('../web/app.mjs');
  const settle = () => new Promise(resolve => setTimeout(resolve, 25));
  await settle();
  assert.equal($('session-status').textContent, 'Signed in · n8n user');
  assert.equal($('execution-browser').hidden, true); assert.equal($('bulk-panel').hidden, true);
  assert.equal(steps[0].attributes['aria-current'], 'step');
  $('workflow-id').value = 'wf'; $('workflow-id').events.input();
  assert.equal($('execution-browser').hidden, false); assert.equal(steps[1].attributes['aria-current'], 'step');
  $('execution-filters').events.submit({preventDefault() {}}); await settle();
  assert.equal($('execution-list-status').textContent, '1 execution on this page · 1 total.');
  const checkbox = $('execution-rows').children[0].children[0].children[0];
  const executionLink = $('execution-rows').children[0].children[1].children[0];
  assert.equal(executionLink.textContent, '101');
  assert.equal(executionLink.href, '/workflow/wf/executions/101');
  assert.equal(executionLink.target, '_blank'); assert.equal(executionLink.rel, 'noopener');
  assert.equal(executionLink.attributes['aria-label'], 'View execution 101 in n8n (new tab)');
  assert.equal(checkbox.attributes['aria-label'], 'Select execution 101');
  checkbox.checked = true; checkbox.events.change();
  assert.equal($('bulk-panel').hidden, false); assert.equal(steps[2].attributes['aria-current'], 'step');
  assert.equal($('selection-count').textContent, '1 selected');
  $('operation-mode').value = 'retry'; $('filter-after').value = '2026-10-11T10:00';
  $('confirm-effects').checked = true; $('bulk-confirm').checked = true;
  $('page-reset').events.click(); await settle();
  assert.equal($('workflow-id').value, ''); assert.equal($('workflow-picker').value, '');
  assert.equal($('operation-mode').value, 'replay'); assert.equal($('filter-status').value, 'terminal');
  assert.equal($('filter-after').value, ''); assert.equal($('confirm-effects').checked, false);
  assert.equal($('bulk-confirm').checked, false); assert.equal($('execution-browser').hidden, true);
  assert.equal($('bulk-panel').hidden, true); assert.equal(steps[0].attributes['aria-current'], 'step');
  assert.equal(storage.get('replay-manager:v2:previous'), 'marker');
  assert.equal(storage.get('n8n-browserId'), 'fixture-browser-id-123456');
  assert.equal($('page-reset').disabled, false);
});
