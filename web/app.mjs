import { config } from './config.mjs';
import './theme.mjs';
import { createApi, createManager } from './client.mjs';
import { parseSelection, prepareSelection } from './bulk.mjs';
const $ = id => document.getElementById(id);
const messages = {
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
  pinned_data: 'Ce workflow contient des données épinglées. Ce POC ne couvre pas ce cas.',
  unsupported_trigger: 'Le Webhook configuré est absent, désactivé ou incompatible.',
  ambiguous_trigger: 'Le Webhook doit avoir exactement un passage enregistré, sans erreur.',
  unsupported_task_metadata: 'Le passage Webhook ne contient pas les métadonnées compatibles attendues par n8n.',
  unsupported_data: 'Les données du Webhook sont incompatibles : les binaires, erreurs et structures ambiguës sont refusés.',
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
const ids = () => ({workflowId: $('workflow-id').value.trim(), executionId: $('execution-id').value.trim()});
$('workflow-id').value = config.defaultWorkflowId; $('execution-id').value = config.defaultExecutionId;
function stage(number) { document.querySelectorAll('.steps li').forEach((item, index) => { item.classList.toggle('current', index === number - 1); if (index === number - 1) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current'); }); }
function sync() {
  for (const id of ['workflow-id', 'execution-id', 'preview-button', 'check-button', 'confirm-effects', 'confirm-release', 'bulk-ids', 'bulk-preview']) $(id).disabled = busy;
  $('replay-button').disabled = busy || !ready || !!record || !$('confirm-effects').checked;
  $('release-button').disabled = busy || !$('confirm-release').checked;
}
function say(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
function invalidate() { ready = false; manager.clearApproval(); $('confirm-effects').checked = false; $('preview-panel').hidden = true; $('empty-state').hidden = false; $('result-panel').hidden = true; record = null; stage(1); sync(); }
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
    const versions = error.versions ? ` Version source : ${error.versions.source ?? 'absente'} ; version actuelle : ${error.versions.current ?? 'absente'}.` : '';
    say((messages[error.code] ?? 'L’opération a échoué. Vérifiez son état dans n8n avant toute nouvelle tentative.') + versions, true);
    try { showRecord(await manager.getRecord(ids())); } catch {}
  } finally { busy = false; sync(); }
}
$('source-form').addEventListener('submit', event => {
  event.preventDefault();
  action(async () => {
    invalidate(); say('Vérification de la session, des droits et de la source…');
    const result = await manager.preview(ids());
    $('session-status').textContent = `Connecté · ${result.user.firstName || 'Utilisateur n8n'}`;
    $('workflow-name').textContent = result.plan.workflowName;
    $('source-id').textContent = result.plan.sourceExecutionId;
    $('trigger-name').textContent = result.plan.trigger;
    $('item-count').textContent = String(result.plan.itemCount);
    $('target-version').textContent = result.plan.versionId;
    $('empty-state').hidden = true; $('preview-panel').hidden = false; ready = true; stage(result.record ? 3 : 2);
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
  say(`Rejeu soumis : exécution ${result.executionId}. Vérifiez maintenant le résultat et les effets attendus.`);
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

function clearBulk() { $('bulk-results').replaceChildren(); $('bulk-summary').textContent = ''; }
$('workflow-id').addEventListener('input', clearBulk);
$('bulk-ids').addEventListener('input', clearBulk);
$('bulk-preview').addEventListener('click', () => action(async () => {
  invalidate(); clearBulk();
  const selection = parseSelection(ids().workflowId, $('bulk-ids').value, config);
  const render = rows => {
    $('bulk-results').replaceChildren();
    for (const row of rows) {
      const li = document.createElement('li');
      li.textContent = `${row.executionId} · ${row.code === 'compatible' ? `${row.itemCount} élément(s) · destination actuelle : ${row.workflowName} · version ${row.versionId}` : messages[row.code] ?? 'Source incompatible.'}`;
      $('bulk-results').append(li);
    }
    $('bulk-summary').textContent = `${rows.length}/${selection.length} vérifiées · ${rows.filter(row => row.code === 'compatible').length} compatibles. Aucun envoi.`;
  };
  try {
    await prepareSelection({selection, api, storage: localStorage, locks: navigator.locks, config, onProgress: render});
    say('Sélection vérifiée. Les sources bloquées restent exclues ; une nouvelle validation sera nécessaire avant tout envoi.');
  } catch (error) { clearBulk(); throw error; }
}));
action(async () => { const user = await manager.session(); $('session-status').textContent = `Connecté · ${user.firstName || 'Utilisateur n8n'}`; say('Session n8n disponible. Choisissez une source et vérifiez-la.'); });
