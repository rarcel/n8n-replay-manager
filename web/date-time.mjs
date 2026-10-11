const pad = value => String(value).padStart(2, '0');
export function localDateTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function moveTime(hours, minutes, amount) {
  const total = Math.max(0, Math.min(1439, hours * 60 + minutes + amount));
  return {hours: Math.floor(total / 60), minutes: total % 60};
}

export function createDateTimePicker({value, date, hours, minutes, clear, now = () => new Date(), onChange}) {
  const controls = [date, hours, minutes, clear];
  function seedTime() {
    const current = now(); hours.value = pad(current.getHours()); minutes.value = pad(current.getMinutes());
  }
  function commit() {
    const next = date.value && hours.value !== '' && minutes.value !== '' ? `${date.value}T${pad(Number(hours.value))}:${pad(Number(minutes.value))}` : '';
    if (next === value.value) return;
    value.value = next; onChange();
  }
  function initialize() {
    if (date.disabled) return;
    if (!date.value) { const current = now(); date.value = localDateTime(current).slice(0, 10); hours.value = pad(current.getHours()); minutes.value = pad(current.getMinutes()); commit(); }
  }
  for (const control of [date, hours, minutes]) control.addEventListener('focus', initialize);
  date.addEventListener('input', commit);
  for (const [control, step, maximum] of [[hours, 60, 23], [minutes, 1, 59]]) {
    control.addEventListener('input', () => {
      if (control.value !== '') control.value = String(Math.max(0, Math.min(maximum, Math.trunc(Number(control.value)))));
      commit();
    });
    control.addEventListener('blur', () => { if (control.value !== '') control.value = pad(Number(control.value)); });
    function move(amount) {
      initialize();
      if (hours.value === '' || minutes.value === '') seedTime();
      const next = moveTime(Number(hours.value), Number(minutes.value), amount);
      hours.value = pad(next.hours); minutes.value = pad(next.minutes); commit();
    }
    control.addEventListener('wheel', event => {
      if (control.disabled || !event.deltaY) return;
      event.preventDefault(); move(event.deltaY < 0 ? -step : step);
    }, {passive: false});
    control.addEventListener('keydown', event => {
      if (control.disabled || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      move(event.key === 'Home' ? -1440 : event.key === 'End' ? 1440 : event.key === 'ArrowUp' ? step : -step);
    });
  }
  clear.addEventListener('click', () => { if (!clear.disabled) { date.value = ''; seedTime(); commit(); } });
  seedTime();
  return {
    setDisabled(disabled) { for (const control of controls) control.disabled = disabled; },
    reset() { date.value = ''; seedTime(); value.value = ''; },
  };
}
