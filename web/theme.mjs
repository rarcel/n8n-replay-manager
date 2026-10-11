// n8n 2.42.4 persists its UI theme under N8N_THEME. Read it without changing it.
function preference() {
  try {
    const value = localStorage.getItem('N8N_THEME');
    if (['light', 'dark', 'system'].includes(value)) return value;
    if (value && ['light', 'dark', 'system'].includes(JSON.parse(value))) return JSON.parse(value);
  } catch {}
  return 'system';
}
const system = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const value = preference();
  document.body.dataset.theme = value === 'system' ? (system.matches ? 'dark' : 'light') : value;
}
applyTheme();
system.addEventListener('change', applyTheme);
addEventListener('storage', event => { if (event.key === 'N8N_THEME' || event.key === null) applyTheme(); });
addEventListener('focus', applyTheme);
