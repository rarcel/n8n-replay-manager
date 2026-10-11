import { config } from './config.mjs';
import './theme.mjs';
import { createApi, createManager } from './client.mjs';
import { parseSelection, createBulkManager } from './bulk.mjs';
import { createWorkflowPicker } from './workflow-picker.mjs';
import { createExplorer, localDateToIso } from './explorer.mjs';
const $ = id => document.getElementById(id);
const messages = {
  another_operation_busy: 'Une opération est déjà en cours.',
  retry_unavailable: 'Retry indisponible : la source doit être en erreur avec un état de reprise enregistré compatible, sans attente ni passages multiples.',
  retry_node_changed: 'Un node à reprendre a disparu, changé de type ou est désactivé dans le workflow actuel.',
  invalid_operation: 'Choisissez Rejeu ou Retry.',
  invalid_filter: 'Les filtres ou la pagination sont invalides.',
  bulk_selection_invalid: 'Sélectionnez de 1 à 50 IDs valides pour un même workflow.',
  bulk_duplicate: 'La sélection contient un ID répété. Retirez le doublon.',
  open_editor_first: 'Ouvrez n8n et connectez-vous sur ce même domaine, puis revenez ici.',
  session_expired: 'Votre session a expiré ou nécessite une vérification. Reconnectez-vous dans n8n.',
  session_changed: 'Le compte connecté a changé. Vérifiez à nouveau la source.',
  access_denied: 'Cette ressource est absente ou inaccessible avec vos droits n8n.',
  workflow_scope_missing: 'Votre compte doit pouvoir lire et exécuter ce workflow.',
  invalid_ids: 'Renseignez un identifiant de workflow et un numéro d’exécution valides.',
  workflow_not_configured: 'Ce workflow n’est pas configuré pour le rejeu dans cette interface.',
  workflow_mismatch: 'L’exécution source ne correspond pas au workflow choisi.',
  source_not_terminal: 'La source doit être une exécution terminée, en succès ou en erreur.',
  workflow_version_unavailable: 'La version du workflow actuel est absente. Impossible de vérifier sa stabilité avant l’envoi ; le rejeu est bloqué.',
  pinned_data: 'Données épinglées incompatibles : le rejeu manuel peut utiliser les pins et le retry exige un état sans pins. Désépinglez dans l’éditeur, enregistrez le workflow, puis vérifiez à nouveau. Le manager ne modifie pas ces données ; les pins d’un état source enregistré restent bloquants pour le retry.',
  unsupported_trigger: 'Aucun déclencheur Webhook, Schedule Trigger, Manual Trigger ou When Executed by Another Workflow compatible n’est disponible dans le workflow actuel.',
  ambiguous_trigger: 'La source doit identifier un seul déclencheur compatible, avec un seul passage sans erreur.',
  unsupported_task_metadata: 'Le passage du déclencheur ne contient pas les métadonnées compatibles attendues par n8n.',
  unsupported_data: 'Les données du déclencheur sont incompatibles : les binaires, erreurs et structures ambiguës sont refusés.',
  redacted_data: 'Ces données sont masquées par n8n. Leur rejeu est bloqué ; aucun démasquage n’est demandé.',
  invalid_execution_data: 'Le format des données enregistrées n’est pas compatible avec ce POC.',
  execution_unavailable: 'Les données de cette exécution ne sont pas disponibles ou dépassent la limite d’affichage n8n.',
  data_too_large: 'Les données enregistrées dépassent la limite de lecture du POC.',
  payload_too_large: 'Les données à rejouer dépassent la limite de 2 Mo.',
  preview_required: 'Vérifiez à nouveau la source et confirmez les effets avant de rejouer.',
  preview_changed: 'La source ou le workflow a changé depuis la vérification. Vérifiez à nouveau.',
  existing_reservation: 'Une tentative existe déjà pour cette source dans ce navigateur. Vérifiez son résultat avant toute nouvelle tentative.',
  another_tab_busy: 'Un autre onglet traite déjà cette source. Patientez puis vérifiez le résultat.',
  locks_unavailable: 'Le navigateur ne permet pas le verrouillage entre onglets. Utilisez un navigateur récent avec HTTPS.',
  storage_unavailable: 'Le stockage local est indisponible. Le rejeu est bloqué pour conserver la protection locale.',
  outcome_unknown: 'La réponse du rejeu est inconnue. Une exécution peut avoir été créée : vérifiez dans n8n avant tout nouvel envoi.',
  waiting_for_webhook: 'n8n attend un appel Webhook au lieu de démarrer immédiatement. Vérifiez cette attente dans n8n ; aucun nouvel envoi automatique.',
  network_error: 'La lecture n8n a échoué. Vérifiez la connexion puis réessayez la vérification.',
  upstream_error: 'n8n a refusé la lecture. Vérifiez votre session et la configuration de l’instance.',
  invalid_response: 'La réponse n8n est incompatible. Vérifiez la configuration et la version de l’instance.',
  acknowledgement_required: 'Confirmez d’abord la vérification des exécutions et le risque de doublon.',
  no_result: 'Aucun identifiant de résultat n’a été reçu. Consultez les exécutions dans n8n.',
  result_mismatch: 'Le résultat ne correspond pas au workflow ou au mode manuel attendu.',
};
let busy = false, ready = false, record = null;
const api = createApi({storage: localStorage});
const manager = createManager({api, storage: localStorage, locks: navigator.locks, config});
const explorer = createExplorer({api, config});
const bulk = createBulkManager({api, storage: localStorage, locks: navigator.locks, config});
let bulkReady = false, bulkRunning = false;
const operation = () => $('operation-mode').value;
const ids = () => ({workflowId: $('workflow-id').value.trim(), executionId: $('execution-id').value.trim(), ...(operation() === 'retry' ? {operation: 'retry'} : {})});
const picker = createWorkflowPicker({input: $('workflow-picker'), dropdown: $('workflow-dropdown'), list: $('workflow-options'), status: $('workflow-picker-status'), more: $('workflow-more'), api, config,
  onClear() { $('workflow-id').value = ''; $('execution-id').value = ''; invalidate(); resetExplorer(); },
  onSelect(row) { $('workflow-id').value = row.id; $('execution-id').value = ''; invalidate(); resetExplorer(); action(searchExecutions).then(() => $('filter-status').focus()); },
  onError(error) { say(messages[error.code] ?? 'Recherche indisponible.', true); }
});
function stage(number) { document.querySelectorAll('.steps li').forEach((item, index) => { item.classList.toggle('current', index === number - 1); if (index === number - 1) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current'); }); }
function sync() {
  picker.setBusy(busy);
  for (const id of ['operation-mode', 'workflow-id', 'execution-id', 'check-button', 'confirm-effects', 'confirm-release', 'bulk-ids', 'bulk-preview', 'filter-status', 'filter-after', 'filter-before', 'execution-search', 'execution-more', 'selection-clear', 'bulk-confirm']) $(id).disabled = busy;
  document.querySelectorAll('#execution-rows input, #execution-rows button').forEach(control => { control.disabled = busy || control.dataset.blocked === 'true'; });
  $('bulk-preview').disabled = busy || !explorer.selection().length;
  $('execution-search').disabled = busy || !$('workflow-id').value;
  $('filter-status').disabled = busy || operation() === 'retry';
  $('selection-clear').disabled = busy || !explorer.selection().length;
  $('bulk-run').disabled = busy || !bulkReady || !$('bulk-confirm').checked;
  $('bulk-stop').hidden = !bulkRunning;
  document.querySelectorAll('#bulk-results button').forEach(button => { button.disabled = busy; });
  $('replay-button').disabled = busy || !ready || !!record || !$('confirm-effects').checked;
  $('release-button').disabled = busy || !$('confirm-release').checked;
}
function say(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
function invalidate() { ready = false; manager.clearApproval(); $('confirm-effects').checked = false; $('preview-panel').hidden = true; $('individual-review').hidden = true; $('empty-state').hidden = false; $('result-panel').hidden = true; record = null; stage(1); sync(); }
function showRecord(value) {
  record = value; $('result-panel').hidden = !value;
  if (!value) { sync(); return; }
  const labels = {pending: 'Envoi réservé ; résultat à vérifier dans n8n.', unknown: 'Réponse inconnue. Vérifiez dans n8n avant toute nouvelle tentative.', waitingForWebhook: 'n8n attend un appel Webhook. Le rejeu immédiat n’est pas confirmé.', submitted: `Nouvelle exécution ${value.executionId} créée. Sa réussite reste à vérifier.`};
  $('result-text').textContent = labels[value.status] ?? 'Une tentative a déjà été enregistrée pour cette source.';
  const hasResult = /^[0-9]{1,30}$/.test(value.executionId ?? '');
  $('result-link').hidden = !hasResult; $('check-button').hidden = !hasResult;
  if (hasResult) $('result-link').href = `/workflow/${encodeURIComponent(ids().workflowId)}/executions/${value.executionId}`;
  $('confirm-release').checked = false; sync();
}
async function action(callback) {
  if (busy) return;
  busy = true; sync();
  try { await callback(); }
  catch (error) {
    ready = false; $('confirm-effects').checked = false;
    if (['session_changed', 'session_expired', 'open_editor_first'].includes(error.code)) {
      resetExplorer(); manager.clearApproval();
      $('workflow-id').value = ''; $('execution-id').value = ''; picker.reset();
    }
    const versions = error.versions ? ` Version source : ${error.versions.source ?? 'absente'} ; version actuelle : ${error.versions.current ?? 'absente'}.` : '';
    say((messages[error.code] ?? 'L’opération a échoué. Vérifiez son état dans n8n avant toute nouvelle tentative.') + versions, true);
    try { showRecord(await manager.getRecord(ids())); } catch {}
  } finally { busy = false; sync(); }
}
$('source-form').addEventListener('submit', event => {
  event.preventDefault();
  action(async () => {
    invalidate(); clearBulk(); say('Vérification de la session, des droits et de la source…');
    const result = await manager.preview(ids());
    $('session-status').textContent = `Connecté · ${result.user.firstName || 'Utilisateur n8n'}`;
    $('workflow-name').textContent = result.plan.workflowName;
    $('source-id').textContent = result.plan.sourceExecutionId;
    $('trigger-name').textContent = result.plan.trigger;
    $('item-count').textContent = String(result.plan.itemCount);
    $('target-version').textContent = result.plan.versionId;
    $('replay-button').textContent = result.plan.operation === 'retry' ? 'Lancer le retry natif' : 'Lancer le rejeu';
    $('individual-review').hidden = false; $('empty-state').hidden = true; $('preview-panel').hidden = false; ready = true; stage(result.record ? 3 : 2);
    $('individual-review').scrollIntoView({block: 'start', behavior: 'smooth'});
    showRecord(result.record);
    say(result.record ? 'Source vérifiée. Une tentative existe déjà : consultez son état avant un nouvel envoi.' : 'Source compatible. Aucune exécution n’a été lancée.');
  });
});
for (const id of ['workflow-id', 'execution-id']) $(id).addEventListener('input', invalidate);
$('confirm-effects').addEventListener('change', sync); $('confirm-release').addEventListener('change', sync);
$('replay-button').addEventListener('click', () => action(async () => {
  say('Dernière vérification, puis envoi à n8n…');
  const result = await manager.submit(ids(), $('confirm-effects').checked);
  ready = false; $('confirm-effects').checked = false; showRecord(result); stage(3);
  say(`${result.operation === 'retry' ? 'Retry' : 'Rejeu'} soumis : exécution ${result.executionId}. Vérifiez maintenant le résultat et les effets attendus.`);
}));
$('check-button').addEventListener('click', () => action(async () => {
  const result = await manager.check(ids());
  const label = result.status === 'success' && result.stoppedAt ? 'Terminée avec succès. Vérifiez aussi les effets métier.' : result.status === 'error' ? 'Terminée en erreur. Consultez le détail dans n8n.' : `État actuel : ${result.status ?? 'indisponible'}.`;
  $('result-text').textContent = `Exécution ${result.id} · ${label}`;
  say('État du résultat relu dans n8n.');
}));
$('release-button').addEventListener('click', () => action(async () => {
  await manager.release(ids(), $('confirm-release').checked); invalidate(); say('Blocage local levé explicitement. Vérifiez à nouveau la source avant de rejouer.');
}));
stage(1); sync();

function clearBulk() {
  bulk.clearApproval(); bulkReady = false; $('bulk-confirm').checked = false;
  $('bulk-confirmation').hidden = true; $('bulk-target').textContent = '';
  $('bulk-results').replaceChildren(); $('bulk-summary').textContent = '';
}
$('workflow-id').addEventListener('input', resetExplorer);
$('bulk-preview').addEventListener('click', () => action(async () => {
  invalidate(); clearBulk();
  const selection = parseSelection(ids().workflowId, explorer.selection().join(' '), config, operation());
  const render = rows => { renderBulkRows(rows);
    $('bulk-summary').textContent = `${rows.length}/${selection.length} vérifiées · ${rows.filter(row => row.code === 'compatible').length} compatibles. Aucun envoi.`; };
  try {
    const result = await bulk.preview(selection, render); bulkReady = result.runnable;
    $('bulk-confirmation').hidden = !bulkReady;
    if (bulkReady) {
      const first = result.rows[0];
      $('bulk-target').textContent = `${operation() === 'retry' ? 'Retry natif' : 'Rejeu'} · ${result.rows.length} sources · ${result.rows.reduce((sum, row) => sum + row.itemCount, 0)} éléments · destination : workflow actuel ${first.workflowName} (${ids().workflowId}) · version ${first.versionId}.`;
    }
    say(bulkReady ? 'Toutes les sources sont compatibles. Examinez la destination et confirmez les effets avant de lancer le lot.' : 'Lot bloqué. Retirez les sources incompatibles ou déjà réservées puis vérifiez à nouveau.');
  } catch (error) { clearBulk(); throw error; }
}));

function renderBulkRows(rows) {
  const workflowId = ids().workflowId;
  $('bulk-results').replaceChildren();
  for (const row of rows) {
    const li = document.createElement('li'), text = document.createElement('span');
    const state = {not_sent: 'Non envoyée', sending: 'Dernière vérification / envoi en cours', submitted: `Soumise : ${row.resultExecutionId} · réussite à vérifier`, blocked: messages[row.code] ?? 'Envoi bloqué ou résultat inconnu'};
    text.textContent = `${row.executionId} · ${row.status ? state[row.status] : row.code === 'compatible' ? `${row.operation === 'retry' ? 'Retry · nodes à reprendre' : 'Rejeu · déclencheur'} : ${row.trigger} · ${row.itemCount} élément(s) · ${row.workflowName} · version ${row.versionId}` : messages[row.code] ?? 'Source incompatible.'}`;
    li.append(text);
    if (row.status === 'submitted') {
      const link = document.createElement('a'); link.className = 'button secondary'; link.textContent = 'Voir dans n8n'; link.target = '_blank'; link.rel = 'noopener';
      link.href = `/workflow/${encodeURIComponent(workflowId)}/executions/${row.resultExecutionId}`; li.append(link);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'button secondary'; button.textContent = 'Vérifier le résultat';
      button.addEventListener('click', () => action(async () => {
        const result = await manager.check({workflowId, executionId: row.executionId});
        text.textContent = `${row.executionId} → ${result.id} · ${result.status === 'success' && result.stoppedAt ? 'Terminée avec succès ; vérifiez aussi les effets métier.' : result.status === 'error' ? 'Terminée en erreur.' : `État : ${result.status ?? 'indisponible'}.`}`;
      })); li.append(button);
    }
    if (row.code === 'existing_reservation' || row.status === 'blocked') {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'button secondary'; button.textContent = 'Examiner la tentative';
      button.addEventListener('click', () => { $('execution-id').value = row.executionId; invalidate(); $('source-form').requestSubmit(); }); li.append(button);
    }
    $('bulk-results').append(li);
  }
  sync();
}
$('bulk-confirm').addEventListener('change', sync);
$('bulk-stop').addEventListener('click', () => { bulk.stop(); $('bulk-stop').disabled = true; say('Arrêt demandé. Aucun nouvel envoi après la tentative en cours.'); });
$('bulk-run').addEventListener('click', () => action(async () => {
  const selection = parseSelection(ids().workflowId, explorer.selection().join(' '), config, operation());
  const confirmed = $('bulk-confirm').checked;
  bulkReady = false; bulkRunning = true; $('bulk-confirm').checked = false; $('bulk-confirmation').hidden = true; $('bulk-stop').disabled = false; sync();
  try {
    const result = await bulk.submit(selection, confirmed, rows => {
      renderBulkRows(rows);
      $('bulk-summary').textContent = `${rows.filter(row => row.status === 'submitted').length}/${rows.length} soumises · ${rows.filter(row => row.status === 'not_sent').length} non envoyées.`;
    });
    renderBulkRows(result.rows);
    say(result.reason === 'complete' ? 'Lot soumis. Vérifiez chaque résultat et les effets métier.' : result.reason === 'stopped' ? 'Lot arrêté entre deux envois. Les sources restantes n’ont pas été envoyées.' : result.reason === 'retry_not_successful' ? 'Lot arrêté : le dernier retry n’a pas terminé avec succès. Vérifiez son résultat ; les sources suivantes n’ont pas été envoyées.' : 'Lot interrompu au premier refus ou résultat ambigu. Examinez la tentative avant toute nouvelle action.', ['error', 'retry_not_successful'].includes(result.reason));
  } finally { bulkRunning = false; sync(); }
}));
function syncSelection() {
  $('bulk-ids').value = explorer.selection().join('\n');
  $('selection-count').textContent = `${explorer.selection().length}/50 sélectionnées`;
  clearBulk(); sync();
}
function resetExplorer() {
  explorer.reset(); $('execution-rows').replaceChildren(); $('execution-more').hidden = true;
  $('execution-list-status').textContent = 'Choisissez un workflow puis appliquez les filtres.';
  syncSelection();
}
function renderPage(page) {
  $('execution-rows').replaceChildren();
  for (const row of page.rows) {
    const tr = document.createElement('tr');
    const choice = document.createElement('td'), checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.checked = explorer.selection().includes(row.id);
    checkbox.dataset.blocked = String(!row.selectable); checkbox.disabled = !row.selectable;
    checkbox.setAttribute('aria-label', `Sélectionner l’exécution ${row.id}`);
    checkbox.title = row.reason;
    if (row.reason) checkbox.setAttribute('aria-label', `Exécution ${row.id} : ${row.reason}`); choice.append(checkbox); tr.append(choice);
    checkbox.addEventListener('change', () => {
      try { explorer.select(row.id, checkbox.checked); invalidate(); syncSelection(); }
      catch (error) { checkbox.checked = explorer.selection().includes(row.id); say(messages[error.code] ?? 'Sélection impossible.', true); }
    });
    for (const text of [row.id, row.status === 'success' ? 'Succès' : 'Erreur', row.startedAt ? new Date(row.startedAt).toLocaleString('fr-FR') : 'Sans date de démarrage']) {
      const td = document.createElement('td'); td.textContent = text; tr.append(td);
    }
    $('execution-rows').append(tr);
  }
  $('execution-more').hidden = page.nextCursor === null;
  const total = page.count === -1 ? 'total indisponible' : `${page.estimated ? 'environ ' : ''}${page.count} au total`;
  $('execution-list-status').textContent = page.rows.length ? `${page.rows.length} exécution${page.rows.length > 1 ? 's' : ''} sur cette page · ${total}.` : 'Aucune exécution sur cette page pour ces filtres.';
  sync();
}
$('operation-mode').addEventListener('change', () => {
  invalidate(); resetExplorer();
  const retry = operation() === 'retry';
  if (retry) $('filter-status').value = 'error';
  $('operation-help').textContent = retry ? 'Retry : reprend l’état enregistré de l’échec avec le workflow actuel. Un node peut répéter ses effets ; le contexte enregistré du sous-workflow peut être conservé. La vérification détermine si la reprise est possible.' : 'Rejeu : repart du déclencheur avec ses sorties enregistrées, dans le workflow actuel.';
  $('bulk-confirm-label').textContent = `Je confirme le ${retry ? 'retry natif' : 'rejeu'} de toutes les sources listées dans le workflow actuel affiché et j’accepte les effets possibles.`;
  $('bulk-operation-description').textContent = retry ? 'n8n reprend sa pile enregistrée avec la définition actuelle. Le node en échec peut avoir déjà produit des effets qui seront répétés. Aucun retry automatique des envois du manager.' : 'Les sorties enregistrées seront rejouées dans la définition et les credentials actuels. Les envois sont séquentiels ; un nouvel ID signifie soumis, sa réussite reste à contrôler.';
  $('bulk-run').textContent = retry ? 'Lancer les retries' : 'Lancer le lot';
  sync(); if (ids().workflowId) action(searchExecutions);
});
for (const id of ['filter-status', 'filter-after', 'filter-before']) $(id).addEventListener('input', () => { invalidate(); resetExplorer(); });
async function searchExecutions() {
  invalidate(); resetExplorer();
  const page = await explorer.search({workflowId: ids().workflowId, status: $('filter-status').value,
    startedAfter: localDateToIso($('filter-after').value), startedBefore: localDateToIso($('filter-before').value)});
  renderPage(page); say('Exécutions chargées. Ajustez les filtres ou cochez les sources à préparer.');
}
$('execution-filters').addEventListener('submit', event => { event.preventDefault(); action(searchExecutions); });
$('execution-more').addEventListener('click', () => action(async () => {
  try { renderPage(await explorer.more()); }
  catch (error) { resetExplorer(); throw error; }
}));
$('selection-clear').addEventListener('click', () => {
  explorer.clearSelection(); invalidate(); syncSelection();
  document.querySelectorAll('#execution-rows input').forEach(checkbox => { checkbox.checked = false; });
});
action(async () => { const user = await manager.session(); $('session-status').textContent = `Connecté · ${user.firstName || 'Utilisateur n8n'}`; await picker.search(); });
