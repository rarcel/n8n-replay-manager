import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflowPicker } from '../web/workflow-picker.mjs';
import { config } from '../web/config.mjs';

class Element {
  constructor() { this.children = []; this.events = {}; this.attributes = {}; this.value = ''; this.hidden = false; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(name, fn) { this.events[name] = fn; }
  append(child) { this.children.push(child); }
  replaceChildren() { this.children = []; }
  scrollIntoView() {}
  contains(element) { return element === this || this.children.includes(element); }
  emit(name, properties = {}) { this.events[name]?.({preventDefault() {}, ...properties}); }
}
function harness(t, workflows) {
  const previous = globalThis.document;
  globalThis.document = {createElement: () => new Element()};
  t.after(() => { globalThis.document = previous; });
  const input = new Element(), dropdown = new Element(), list = new Element(), status = new Element(), more = new Element();
  input.parentElement = new Element();
  const selected = [], errors = []; let clears = 0;
  const picker = createWorkflowPicker({input, dropdown, list, status, more, api: {user: async () => ({id: 'user'}), workflows}, config,
    onClear: () => clears++, onSelect: row => selected.push(row), onError: error => errors.push(error)});
  return {picker, input, dropdown, list, status, more, selected, errors, clears: () => clears};
}
const row = (id, scopes = ['workflow:read', 'workflow:execute']) => ({id, name: `Nom <${id}>`, scopes});

test('workflow picker requires explicit choice, supports keyboard and keeps received labels as text', async t => {
  const h = harness(t, async () => ({count: 2, data: [row('blocked', ['workflow:read']), row('allowed')]}));
  await h.picker.search('Nom');
  assert.deepEqual(h.selected, []);
  assert.equal(h.list.children[1].textContent, 'Nom <allowed> · allowed');
  h.input.emit('keydown', {key: 'ArrowDown'});
  assert.equal(h.input.attributes['aria-activedescendant'], 'workflow-option-1');
  h.input.emit('keydown', {key: 'Enter'});
  assert.equal(h.selected[0].id, 'allowed'); assert.equal(h.dropdown.hidden, true);
  h.input.value = 'arbitrary text'; h.input.emit('input');
  assert.equal(h.clears(), 1); assert.equal(h.selected.length, 1);
  h.picker.reset();
});
test('workflow picker discards stale search responses and preserves filter for more results', async t => {
  let finishOld; const calls = [];
  const h = harness(t, async query => {
    calls.push(query);
    if (query.name === 'old') return new Promise(resolve => { finishOld = resolve; });
    return {count: 2, data: [row(query.skip ? 'second' : 'first')]};
  });
  const old = h.picker.search('old');
  await Promise.resolve(); await Promise.resolve();
  await h.picker.search('new');
  finishOld({count: 1, data: [row('stale')]}); await old;
  assert.equal(h.list.children[0].textContent, 'Nom <first> · first');
  h.more.emit('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.at(-1), {skip: 1, name: 'new'});
  assert.equal(h.list.children.length, 2);
  h.picker.setBusy(true); h.list.children[0].emit('click');
  assert.equal(h.selected.length, 0); h.picker.reset();
});
