import { createDateTimePicker } from './date-time.mjs';
import { t, dateLocale, localizePage } from './i18n.mjs';
import { journey, redirectToEditor } from './journey.mjs';
import { config } from './config.mjs';
import './theme.mjs';
import { createApi, createManager } from './client.mjs';
import { parseSelection, createBulkManager } from './bulk.mjs';
import { createWorkflowPicker } from './workflow-picker.mjs';
import { createExplorer, localDateToIso } from './explorer.mjs';
localizePage(document);
const $ = id => document.getElementById(id);
const messages = {
  large_batch_confirmation_required: t('Validez l’avertissement pour lancer plus de 50 exécutions.'),
  selection_scan_limit: t('La recherche dépasse 100 pages. Affinez les filtres ; la sélection précédente est conservée.'),
  another_operation_busy: t("Une opération est déjà en cours."),
  retry_unavailable: t("Retry indisponible : la source doit être en erreur avec un état de reprise enregistré compatible, sans attente ni passages multiples."),
  retry_node_changed: t("Un node à reprendre a disparu, changé de type ou est désactivé dans le workflow actuel."),
  invalid_operation: t("Choisissez Rejeu ou Retry."),
  invalid_filter: t("Les filtres ou la pagination sont invalides."),
  bulk_selection_invalid: t("Sélectionnez des IDs valides pour un même workflow."),
  bulk_duplicate: t("La sélection contient un ID répété. Retirez le doublon."),
  open_editor_first: t("Ouvrez n8n et connectez-vous sur ce même domaine, puis revenez ici."),
  session_expired: t("Votre session a expiré ou nécessite une vérification. Reconnectez-vous dans n8n."),
  session_changed: t("Le compte connecté a changé. Vérifiez à nouveau la source."),
  access_denied: t("Cette ressource est absente ou inaccessible avec vos droits n8n."),
  workflow_scope_missing: t("Votre compte doit pouvoir lire et exécuter ce workflow."),
  invalid_ids: t("Renseignez un identifiant de workflow et un numéro d’exécution valides."),
  workflow_not_configured: t("Ce workflow n’est pas configuré pour le rejeu dans cette interface."),
  workflow_mismatch: t("L’exécution source ne correspond pas au workflow choisi."),
  source_not_terminal: t("La source doit être une exécution terminée, en succès ou en erreur."),
  workflow_version_unavailable: t("La version du workflow actuel est absente. Impossible de vérifier sa stabilité avant l’envoi ; le rejeu est bloqué."),
  pinned_data: t("Données épinglées incompatibles : le rejeu manuel peut utiliser les pins et le retry exige un état sans pins. Désépinglez dans l’éditeur, enregistrez le workflow, puis vérifiez à nouveau. Le manager ne modifie pas ces données ; les pins d’un état source enregistré restent bloquants pour le retry."),
  unsupported_trigger: t("Aucun déclencheur Webhook, Schedule Trigger, Manual Trigger ou When Executed by Another Workflow compatible n’est disponible dans le workflow actuel."),
  ambiguous_trigger: t("La source doit identifier un seul déclencheur compatible, avec un seul passage sans erreur."),
  unsupported_task_metadata: t("Le passage du déclencheur ne contient pas les métadonnées compatibles attendues par n8n."),
  unsupported_data: t("Les données du déclencheur sont incompatibles : les binaires, erreurs et structures ambiguës sont refusés."),
  redacted_data: t("Ces données sont masquées par n8n. Leur rejeu est bloqué ; aucun démasquage n’est demandé."),
  invalid_execution_data: t("Le format des données enregistrées n’est pas compatible avec ce manager."),
  execution_unavailable: t("Les données de cette exécution ne sont pas disponibles ou dépassent la limite d’affichage n8n."),
  data_too_large: t("Les données enregistrées dépassent la limite de lecture du manager."),
  payload_too_large: t("Les données à rejouer dépassent la limite de 2 Mo."),
  preview_required: t("Vérifiez à nouveau la source et confirmez les effets avant de rejouer."),
  preview_changed: t("La source ou le workflow a changé depuis la vérification. Vérifiez à nouveau."),
  existing_reservation: t("Une tentative existe déjà pour cette source dans ce navigateur. Vérifiez son résultat avant toute nouvelle tentative."),
  another_tab_busy: t("Un autre onglet traite déjà cette source. Patientez puis vérifiez le résultat."),
  locks_unavailable: t("Le navigateur ne permet pas le verrouillage entre onglets. Utilisez un navigateur récent avec HTTPS."),
  storage_unavailable: t("Le stockage local est indisponible. Le rejeu est bloqué pour conserver la protection locale."),
  outcome_unknown: t("La réponse du rejeu est inconnue. Une exécution peut avoir été créée : vérifiez dans n8n avant tout nouvel envoi."),
  waiting_for_webhook: t("n8n attend un appel Webhook au lieu de démarrer immédiatement. Vérifiez cette attente dans n8n ; aucun nouvel envoi automatique."),
  network_error: t("La lecture n8n a échoué. Vérifiez la connexion puis réessayez la vérification."),
  upstream_error: t("n8n a refusé la lecture. Vérifiez votre session et la configuration de l’instance."),
  invalid_response: t("La réponse n8n est incompatible. Vérifiez la configuration de l’instance."),
  acknowledgement_required: t("Confirmez d’abord la vérification des exécutions et le risque de doublon."),
  no_result: t("Aucun identifiant de résultat n’a été reçu. Consultez les exécutions dans n8n."),
  result_mismatch: t("Le résultat ne correspond pas au workflow ou au mode manuel attendu."),
};
let busy = false, ready = false, record = null;
const datePickers = ['after', 'before'].map(bound => createDateTimePicker({
  value: $('filter-' + bound), date: $('filter-' + bound + '-date'), hours: $('filter-' + bound + '-hours'),
  minutes: $('filter-' + bound + '-minutes'), clear: $('filter-' + bound + '-clear'),
  onChange() { invalidate(); resetExplorer(); },
}));
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
  onError(error) { redirectToEditor(error, window.location); say(messages[error.code] ?? t("Recherche indisponible."), true); }
});
function stage(number) { document.querySelectorAll('.steps li').forEach((item, index) => { item.classList.toggle('current', index === number - 1); item.classList.toggle('complete', index < number - 1); if (index === number - 1) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current'); }); }
function sync() {
  const view = journey({workflowId: $('workflow-id').value, selected: explorer.selection().length, reviewing: !$('individual-review').hidden || $('bulk-results').children.length > 0});
  $('execution-browser').hidden = !view.executionsVisible;
  $('bulk-panel').hidden = !view.reviewVisible || !$('individual-review').hidden;
  stage(view.step);
  $('page-reset').disabled = busy;
  picker.setBusy(busy);
  datePickers.forEach(picker => picker.setDisabled(busy));
  for (const id of ['operation-mode', 'workflow-id', 'execution-id', 'check-button', 'confirm-effects', 'confirm-release', 'bulk-ids', 'bulk-preview', 'filter-status', 'filter-after', 'filter-before', 'execution-search', 'execution-more', 'selection-clear', 'bulk-confirm', 'large-batch-confirm']) $(id).disabled = busy;
  document.querySelectorAll('#execution-rows input, #execution-rows button').forEach(control => { control.disabled = busy || control.dataset.blocked === 'true'; });
  $('bulk-preview').disabled = busy || !explorer.selection().length;
  $('execution-search').disabled = busy || !$('workflow-id').value;
  $('filter-status').disabled = busy || operation() === 'retry';
  $('selection-clear').disabled = busy || !explorer.selection().length;
  $('selection-all').disabled = busy || !explorer.page;
  $('selection-page').disabled = busy || !explorer.page?.rows.some(row => row.selectable);
  $('bulk-run').disabled = busy || !bulkReady || !$('bulk-confirm').checked || (explorer.selection().length > 50 && !$('large-batch-confirm').checked);
  $('bulk-stop').hidden = !bulkRunning;
  document.querySelectorAll('#bulk-results button').forEach(button => { button.disabled = busy; });
  $('replay-button').disabled = busy || !ready || !!record || !$('confirm-effects').checked;
  $('release-button').disabled = busy || !$('confirm-release').checked;
}
function say(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
function invalidate() { ready = false; manager.clearApproval(); $('confirm-effects').checked = false; $('preview-panel').hidden = true; $('individual-review').hidden = true; $('empty-state').hidden = false; $('result-panel').hidden = true; record = null; sync(); }
function showRecord(value) {
  record = value; $('result-panel').hidden = !value;
  if (!value) { sync(); return; }
  const labels = {pending: t("Envoi réservé ; résultat à vérifier dans n8n."), unknown: t("Réponse inconnue. Vérifiez dans n8n avant toute nouvelle tentative."), waitingForWebhook: t("n8n attend un appel Webhook. Le rejeu immédiat n’est pas confirmé."), submitted: t`Nouvelle exécution ${value.executionId} créée. Sa réussite reste à vérifier.`};
  $('result-text').textContent = labels[value.status] ?? t("Une tentative a déjà été enregistrée pour cette source.");
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
      $('workflow-id').value = ''; $('execution-id').value = ''; picker.reset(); invalidate();
      $('session-status').textContent = t("Session à vérifier");
    }
    redirectToEditor(error, window.location);
    const versions = error.versions ? t` Version source : ${error.versions.source ?? t("absente")} ; version actuelle : ${error.versions.current ?? t("absente")}.` : '';
    say((messages[error.code] ?? t("L’opération a échoué. Vérifiez son état dans n8n avant toute nouvelle tentative.")) + versions, true);
    try { showRecord(await manager.getRecord(ids())); } catch {}
  } finally { busy = false; sync(); }
}
$('source-form').addEventListener('submit', event => {
  event.preventDefault();
  action(async () => {
    invalidate(); clearBulk(); say(t("Vérification de la session, des droits et de la source…"));
    const result = await manager.preview(ids());
    $('session-status').textContent = t`Connecté · ${result.user.firstName || t("Utilisateur n8n")}`;
    $('workflow-name').textContent = result.plan.workflowName;
    $('source-id').textContent = result.plan.sourceExecutionId;
    $('trigger-name').textContent = result.plan.trigger;
    $('item-count').textContent = String(result.plan.itemCount);
    $('target-version').textContent = result.plan.versionId;
    $('replay-button').textContent = result.plan.operation === 'retry' ? t("Lancer le retry natif") : t("Lancer le rejeu");
    $('individual-review').hidden = false; $('empty-state').hidden = true; $('preview-panel').hidden = false; ready = true;
    $('individual-review').scrollIntoView({block: 'start', behavior: 'smooth'});
    showRecord(result.record);
    say(result.record ? t("Source vérifiée. Une tentative existe déjà : consultez son état avant un nouvel envoi.") : t("Source compatible. Aucune exécution n’a été lancée."));
  });
});
for (const id of ['workflow-id', 'execution-id']) $(id).addEventListener('input', invalidate);
$('confirm-effects').addEventListener('change', sync); $('confirm-release').addEventListener('change', sync);
$('replay-button').addEventListener('click', () => action(async () => {
  say(t("Dernière vérification, puis envoi à n8n…"));
  const result = await manager.submit(ids(), $('confirm-effects').checked);
  ready = false; $('confirm-effects').checked = false; showRecord(result);
  say(t`${result.operation === 'retry' ? 'Retry' : t("Rejeu")} soumis : exécution ${result.executionId}. Vérifiez maintenant le résultat et les effets attendus.`);
}));
$('check-button').addEventListener('click', () => action(async () => {
  const result = await manager.check(ids());
  const label = result.status === 'success' && result.stoppedAt ? t("Terminée avec succès. Vérifiez aussi les effets métier.") : result.status === 'error' ? t("Terminée en erreur. Consultez le détail dans n8n.") : t`État actuel : ${result.status ?? t("indisponible")}.`;
  $('result-text').textContent = t`Exécution ${result.id} · ${label}`;
  say(t("État du résultat relu dans n8n."));
}));
$('release-button').addEventListener('click', () => action(async () => {
  await manager.release(ids(), $('confirm-release').checked); invalidate(); say(t("Blocage local levé explicitement. Vérifiez à nouveau la source avant de rejouer."));
}));
sync();

function clearBulk() {
  bulk.clearApproval(); bulkReady = false; $('bulk-confirm').checked = false; $('large-batch-confirm').checked = false;
  $('large-batch-warning').hidden = true; $('large-batch-description').textContent = '';
  $('bulk-confirmation').hidden = true; $('bulk-target').textContent = '';
  $('bulk-results').replaceChildren(); $('bulk-summary').textContent = '';
}
$('workflow-id').addEventListener('input', resetExplorer);
$('bulk-preview').addEventListener('click', () => action(async () => {
  invalidate(); clearBulk();
  const selection = parseSelection(ids().workflowId, explorer.selection().join(' '), config, operation());
  const render = rows => { renderBulkRows(rows.slice($('bulk-results').children.length), true);
    $('bulk-summary').textContent = t`${rows.length}/${selection.length} vérifiées · ${rows.filter(row => row.code === 'compatible').length} compatibles. Aucun envoi.`; };
  try {
    const result = await bulk.preview(selection, render); bulkReady = result.runnable;
    $('bulk-confirmation').hidden = !bulkReady;
    if (bulkReady) {
      $('large-batch-warning').hidden = result.rows.length <= 50;
      $('large-batch-description').textContent = t`Vous allez relancer ${result.rows.length} exécutions. Les effets métier peuvent être répétés et le traitement peut durer longtemps. Validez cet avertissement en plus de la confirmation des effets.`;
      const first = result.rows[0];
      $('bulk-target').textContent = t`${operation() === 'retry' ? t("Retry natif") : t("Rejeu")} · ${result.rows.length} sources · ${result.rows.reduce((sum, row) => sum + row.itemCount, 0)} éléments · destination : workflow actuel ${first.workflowName} (${ids().workflowId}) · version ${first.versionId}.`;
    }
    say(bulkReady ? t("Toutes les sources sont compatibles. Examinez la destination et confirmez les effets avant de lancer le lot.") : t("Lot bloqué. Retirez les sources incompatibles ou déjà réservées puis vérifiez à nouveau."));
  } catch (error) { clearBulk(); throw error; }
}));

function renderBulkRows(rows, append = false) {
  const workflowId = ids().workflowId;
  if (!append) $('bulk-results').replaceChildren();
  for (const row of rows) {
    const li = document.createElement('li'), text = document.createElement('span');
    const state = {not_sent: t("Non envoyée"), sending: t("Dernière vérification / envoi en cours"), submitted: t`Soumise : ${row.resultExecutionId} · réussite à vérifier`, blocked: messages[row.code] ?? t("Envoi bloqué ou résultat inconnu")};
    text.textContent = `${row.executionId} · ${row.status ? state[row.status] : row.code === 'compatible' ? t`${row.operation === 'retry' ? t("Retry · nodes à reprendre") : t("Rejeu · déclencheur")} : ${row.trigger} · ${row.itemCount} élément(s) · ${row.workflowName} · version ${row.versionId}` : messages[row.code] ?? t("Source incompatible.")}`;
    li.append(text);
    if (row.status === 'submitted') {
      const link = document.createElement('a'); link.className = 'button secondary'; link.textContent = t("Voir dans n8n"); link.target = '_blank'; link.rel = 'noopener';
      link.href = `/workflow/${encodeURIComponent(workflowId)}/executions/${row.resultExecutionId}`; li.append(link);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'button secondary'; button.textContent = t("Vérifier le résultat");
      button.addEventListener('click', () => action(async () => {
        const result = await manager.check({workflowId, executionId: row.executionId});
        text.textContent = `${row.executionId} → ${result.id} · ${result.status === 'success' && result.stoppedAt ? t("Terminée avec succès ; vérifiez aussi les effets métier.") : result.status === 'error' ? t("Terminée en erreur.") : t`État : ${result.status ?? t("indisponible")}.`}`;
      })); li.append(button);
    }
    if (row.code === 'existing_reservation' || row.status === 'blocked') {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'button secondary'; button.textContent = t("Examiner la tentative");
      button.addEventListener('click', () => { $('execution-id').value = row.executionId; invalidate(); $('source-form').requestSubmit(); }); li.append(button);
    }
    $('bulk-results').append(li);
  }
  sync();
}
$('bulk-confirm').addEventListener('change', sync);
$('large-batch-confirm').addEventListener('change', sync);
$('bulk-stop').addEventListener('click', () => { bulk.stop(); $('bulk-stop').disabled = true; say(t("Arrêt demandé. Aucun nouvel envoi après la tentative en cours.")); });
$('bulk-run').addEventListener('click', () => action(async () => {
  const selection = parseSelection(ids().workflowId, explorer.selection().join(' '), config, operation());
  const confirmed = $('bulk-confirm').checked;
  const largeBatchConfirmed = $('large-batch-confirm').checked;
  $('large-batch-confirm').checked = false;
  bulkReady = false; bulkRunning = true; $('bulk-confirm').checked = false; $('bulk-confirmation').hidden = true; $('bulk-stop').disabled = false; sync();
  try {
    const result = await bulk.submit(selection, confirmed, rows => {
      renderBulkRows(rows);
      $('bulk-summary').textContent = t`${rows.filter(row => row.status === 'submitted').length}/${rows.length} soumises · ${rows.filter(row => row.status === 'not_sent').length} non envoyées.`;
    }, largeBatchConfirmed);
    renderBulkRows(result.rows);
    say(result.reason === 'complete' ? t("Lot soumis. Vérifiez chaque résultat et les effets métier.") : result.reason === 'stopped' ? t("Lot arrêté entre deux envois. Les sources restantes n’ont pas été envoyées.") : result.reason === 'retry_not_successful' ? t("Lot arrêté : le dernier retry n’a pas terminé avec succès. Vérifiez son résultat ; les sources suivantes n’ont pas été envoyées.") : t("Lot interrompu au premier refus ou résultat ambigu. Examinez la tentative avant toute nouvelle action."), ['error', 'retry_not_successful'].includes(result.reason));
  } finally { bulkRunning = false; sync(); }
}));
function syncSelection() {
  $('bulk-ids').value = explorer.selection().join('\n');
  $('selection-count').textContent = t`${explorer.selection().length} sélectionnées`;
  clearBulk(); sync();
}
function resetExplorer() {
  explorer.reset(); $('execution-rows').replaceChildren(); $('execution-more').hidden = true;
  $('execution-list-status').textContent = t("Choisissez un workflow puis appliquez les filtres.");
  syncSelection();
}
function renderPage(page) {
  $('execution-rows').replaceChildren();
  for (const row of page.rows) {
    const tr = document.createElement('tr');
    const choice = document.createElement('td'), checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.checked = explorer.selection().includes(row.id);
    checkbox.dataset.blocked = String(!row.selectable); checkbox.disabled = !row.selectable;
    checkbox.setAttribute('aria-label', t`Sélectionner l’exécution ${row.id}`);
    checkbox.title = row.reason;
    if (row.reason) checkbox.setAttribute('aria-label', t`Exécution ${row.id} : ${row.reason}`); choice.append(checkbox); tr.append(choice);
    checkbox.addEventListener('change', () => {
      try { explorer.select(row.id, checkbox.checked); invalidate(); syncSelection(); }
      catch (error) { checkbox.checked = explorer.selection().includes(row.id); say(messages[error.code] ?? t("Sélection impossible."), true); }
    });
    const executionCell = document.createElement('td'), executionLink = document.createElement('a');
    executionLink.textContent = row.id;
    executionLink.href = `/workflow/${encodeURIComponent(ids().workflowId)}/executions/${encodeURIComponent(row.id)}`;
    executionLink.target = '_blank'; executionLink.rel = 'noopener';
    executionLink.setAttribute('aria-label', t`Voir l’exécution ${row.id} dans n8n (nouvel onglet)`);
    executionCell.append(executionLink); tr.append(executionCell);
    for (const text of [row.status === 'success' ? t("Succès") : t("Erreur"), row.startedAt ? new Date(row.startedAt).toLocaleString(dateLocale) : t("Sans date de démarrage")]) {
      const td = document.createElement('td'); td.textContent = text; tr.append(td);
    }
    $('execution-rows').append(tr);
  }
  $('execution-more').hidden = page.nextCursor === null;
  const total = page.count === -1 ? t("total indisponible") : t`${page.estimated ? t("environ ") : ''}${page.count} au total`;
  $('execution-list-status').textContent = page.rows.length ? t`${page.rows.length} exécution${page.rows.length > 1 ? 's' : ''} sur cette page · ${total}.` : t('Aucune exécution sur cette page pour ces filtres.');
  sync();
}
function syncOperation() {
  const retry = operation() === 'retry';
  if (retry) $('filter-status').value = 'error';
  $('operation-help').textContent = retry ? t("Retry : reprend l’état enregistré de l’échec avec le workflow actuel. Un node peut répéter ses effets ; le contexte enregistré du sous-workflow peut être conservé. La vérification détermine si la reprise est possible.") : t("Rejeu : repart du déclencheur avec ses sorties enregistrées, dans le workflow actuel.");
  $('bulk-confirm-label').textContent = t`Je confirme le ${retry ? t("retry natif") : t("rejeu")} de toutes les sources listées dans le workflow actuel affiché et j’accepte les effets possibles.`;
  $('bulk-operation-description').textContent = retry ? t("n8n reprend sa pile enregistrée avec la définition actuelle. Le node en échec peut avoir déjà produit des effets qui seront répétés. Aucun retry automatique des envois du manager.") : t("Les sorties enregistrées seront rejouées dans la définition et les credentials actuels. Les envois sont séquentiels ; un nouvel ID signifie soumis, sa réussite reste à contrôler.");
  $('bulk-run').textContent = retry ? t("Lancer les retries") : t("Lancer le lot");
  sync();
}
$('operation-mode').addEventListener('change', () => {
  invalidate(); resetExplorer(); syncOperation();
  if (ids().workflowId) action(searchExecutions);
});
for (const id of ['filter-status', 'filter-after', 'filter-before']) $(id).addEventListener('input', () => { invalidate(); resetExplorer(); });
async function searchExecutions() {
  invalidate(); resetExplorer();
  const page = await explorer.search({workflowId: ids().workflowId, status: $('filter-status').value,
    startedAfter: localDateToIso($('filter-after').value), startedBefore: localDateToIso($('filter-before').value)});
  renderPage(page); say(t("Exécutions chargées. Ajustez les filtres ou cochez les sources à préparer."));
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
function refreshSelectedRows() {
  invalidate(); syncSelection();
  if (explorer.page) renderPage(explorer.page);
}
$('selection-page').addEventListener('click', () => {
  if (busy) return;
  explorer.selectPage(); refreshSelectedRows();
  say(t('Seules les exécutions sélectionnables de cette page sont sélectionnées. Vérifiez la sélection avant tout envoi.'));
});
$('selection-all').addEventListener('click', () => action(async () => {
  invalidate(); clearBulk();
  say(t('Recherche de toutes les exécutions sélectionnables correspondant aux filtres…'));
  try { await explorer.selectAll(); refreshSelectedRows(); }
  catch (error) { if (!explorer.page) resetExplorer(); throw error; }
  say(t('Toutes les exécutions sélectionnables correspondant aux filtres sont sélectionnées. Vérifiez la sélection avant tout envoi.'));
}));
async function loadSession() { const user = await manager.session(); $('session-status').textContent = t`Connecté · ${user.firstName || t("Utilisateur n8n")}`; await picker.search(); }
$('page-reset').addEventListener('click', () => action(async () => {
  picker.reset(); $('workflow-id').value = ''; $('execution-id').value = '';
  $('execution-filters').reset(); datePickers.forEach(picker => picker.reset()); invalidate(); resetExplorer(); syncOperation();
  for (const id of ['workflow-name', 'source-id', 'trigger-name', 'item-count', 'target-version', 'result-text']) $(id).textContent = '';
  $('result-link').removeAttribute('href');
  document.querySelectorAll('#result-panel details').forEach(details => { details.open = false; });
  say(t("Nouvelle sélection. Les protections des tentatives précédentes restent conservées."));
  await loadSession();
}).then(() => $('workflow-picker').focus()));
action(loadSession);
