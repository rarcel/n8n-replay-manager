import { t } from './i18n.mjs';
import { workflowPage } from './catalog.mjs';

// Only an explicit result choice supplies an ID. Typed text never becomes a workflow ID.
export function createWorkflowPicker({input, dropdown, list, status, more, api, config, onClear, onSelect, onError}) {
  let generation = 0, timer, query = '', rows = [], nextSkip = null, userId = null, active = -1, disabled = false;
  const open = value => { dropdown.hidden = !value; input.setAttribute('aria-expanded', String(value)); };
  function highlight(index) {
    active = index;
    [...list.children].forEach((option, i) => option.setAttribute('aria-selected', String(i === active)));
    if (active >= 0) { input.setAttribute('aria-activedescendant', list.children[active].id); list.children[active].scrollIntoView({block: 'nearest'}); }
    else input.removeAttribute('aria-activedescendant');
  }
  function choose(index) {
    const row = rows[index]; if (disabled || !row?.selectable) return;
    generation++; clearTimeout(timer); input.value = row.name; open(false); highlight(-1); onSelect(row);
  }
  function render() {
    list.replaceChildren(); highlight(-1);
    rows.forEach((row, index) => {
      const option = document.createElement('div'); option.id = `workflow-option-${index}`; option.role = 'option';
      option.setAttribute('aria-disabled', String(!row.selectable)); option.setAttribute('aria-selected', 'false');
      option.textContent = `${row.name} · ${row.id}${row.reason ? ` · ${row.reason}` : ''}`;
      option.addEventListener('mousedown', event => event.preventDefault());
      option.addEventListener('click', () => choose(index)); list.append(option);
    });
    more.hidden = nextSkip === null;
    status.textContent = rows.length ? t`${rows.length} résultats chargés` : t("Aucun workflow trouvé.");
  }
  async function search(value = '', append = false) {
    clearTimeout(timer); const request = ++generation;
    if (!append) { query = value.trim(); rows = []; nextSkip = null; userId = null; list.replaceChildren(); highlight(-1); more.hidden = true; }
    more.disabled = true; status.textContent = t("Recherche…");
    try {
      const page = await workflowPage(api, config, append ? nextSkip : 0, query);
      if (request !== generation) return;
      if (append && page.userId !== userId) throw Object.assign(new Error(), {code: 'session_changed'});
      userId = page.userId;
      rows.push(...page.workflows.filter(row => !rows.some(previous => previous.id === row.id)));
      nextSkip = page.nextSkip; render();
    } catch (error) {
      if (request !== generation) return;
      rows = []; nextSkip = null; list.replaceChildren(); highlight(-1); more.hidden = true;
      status.textContent = t("Recherche indisponible. Retapez pour réessayer."); onClear(); onError(error);
    } finally { if (request === generation) more.disabled = disabled; }
  }
  input.addEventListener('input', () => {
    generation++; clearTimeout(timer); rows = []; list.replaceChildren(); highlight(-1); more.hidden = true;
    onClear(); open(true); status.textContent = t("Recherche…");
    timer = setTimeout(() => search(input.value), 250);
  });
  input.addEventListener('focus', () => open(true));
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') { generation++; clearTimeout(timer); open(false); highlight(-1); return; }
    if (event.key === 'Enter') {
      event.preventDefault(); if (active >= 0) choose(active); else { open(true); search(input.value); } return;
    }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault(); open(true);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    let index = active < 0 ? (step > 0 ? -1 : rows.length) : active;
    for (let count = 0; count < rows.length; count++) {
      index = (index + step + rows.length) % rows.length;
      if (rows[index].selectable) { highlight(index); break; }
    }
  });
  input.parentElement.addEventListener('focusout', event => { if (!input.parentElement.contains(event.relatedTarget)) open(false); });
  more.addEventListener('click', () => { if (!disabled && nextSkip !== null) search(query, true); });
  return {search, reset() { generation++; clearTimeout(timer); input.value = ''; rows = []; nextSkip = null; userId = null; render(); open(false); },
    setBusy(value) { disabled = value; input.disabled = value; more.disabled = value; if (value) open(false); }};
}
