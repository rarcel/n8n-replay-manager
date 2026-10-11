import test from 'node:test';
import assert from 'node:assert/strict';
import { createDateTimePicker, localDateTime, moveTime } from '../web/date-time.mjs';

function harness() {
  const element = () => ({value: '', disabled: false, events: {}, addEventListener(name, fn) { this.events[name] = fn; }});
  const value = element(), date = element(), hours = element(), minutes = element(), clear = element();
  let current = new Date(2026, 9, 11, 14, 37), changes = 0;
  const picker = createDateTimePicker({value, date, hours, minutes, clear, now: () => current, onChange: () => changes++});
  return {value, date, hours, minutes, clear, picker, changes: () => changes, setNow(next) { current = next; }};
}

test('opening an empty date seeds current local time without filtering before opening or overwriting a chosen value', () => {
  const h = harness();
  assert.equal(h.value.value, ''); assert.equal(h.hours.value, '14'); assert.equal(h.minutes.value, '37');
  h.date.events.focus(); assert.equal(h.value.value, '2026-10-11T14:37'); assert.equal(h.changes(), 1);
  h.setNow(new Date(2026, 9, 12, 15, 42)); h.date.events.focus();
  assert.equal(h.value.value, '2026-10-11T14:37'); assert.equal(h.changes(), 1);
  h.clear.events.click(); assert.equal(h.value.value, '');
  h.date.events.focus(); assert.equal(h.value.value, '2026-10-12T15:42');
  h.picker.reset(); assert.equal(h.value.value, ''); assert.equal(h.date.value, '');
  assert.equal(localDateTime(new Date(2026, 0, 2, 3, 4)), '2026-01-02T03:04');
});

test('hour and minute wheels clamp at day boundaries without wrapping or changing the date', () => {
  const h = harness(); h.date.events.focus();
  let prevented = 0;
  const wheel = deltaY => ({deltaY, preventDefault() { prevented++; }});
  h.hours.value = '00'; h.minutes.value = '00';
  h.minutes.events.wheel(wheel(-100)); h.hours.events.wheel(wheel(-100));
  assert.equal(h.value.value, '2026-10-11T00:00');
  h.hours.value = '23'; h.minutes.value = '59';
  h.minutes.events.wheel(wheel(100)); h.hours.events.wheel(wheel(100));
  assert.equal(h.value.value, '2026-10-11T23:59');
  h.hours.value = '01'; h.minutes.value = '00'; h.minutes.events.wheel(wheel(-1));
  assert.equal(h.value.value, '2026-10-11T00:59'); assert.equal(prevented, 5);
  h.picker.setDisabled(true); h.minutes.events.wheel(wheel(1));
  assert.equal(h.value.value, '2026-10-11T00:59'); assert.equal(prevented, 5);
  assert.deepEqual(moveTime(23, 59, 60), {hours: 23, minutes: 59});
});

test('typed numbers and keyboard navigation remain bounded; clearing does not leave an active date filter', () => {
  const h = harness(); h.date.events.focus();
  h.hours.value = '24'; h.hours.events.input(); h.minutes.value = '80'; h.minutes.events.input();
  assert.equal(h.value.value, '2026-10-11T23:59');
  h.minutes.events.keydown({key: 'ArrowUp', preventDefault() {}}); assert.equal(h.value.value, '2026-10-11T23:59');
  h.hours.events.keydown({key: 'Home', preventDefault() {}}); assert.equal(h.value.value, '2026-10-11T00:00');
  h.minutes.events.keydown({key: 'ArrowDown', preventDefault() {}}); assert.equal(h.value.value, '2026-10-11T00:00');
  h.minutes.events.keydown({key: 'End', preventDefault() {}}); assert.equal(h.value.value, '2026-10-11T23:59');
  h.minutes.value = ''; h.minutes.events.input(); assert.equal(h.value.value, '');
  h.clear.events.click(); assert.equal(h.date.value, ''); assert.equal(h.value.value, '');
});
