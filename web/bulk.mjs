import { ReplayError, validateIds, operationFor } from './model.mjs';
import { createManager } from './client.mjs';

// Only IDs and digests are kept in approvals; payloads are reloaded before POST.
export function parseSelection(workflowId, text, config, operation = 'replay') {
  operationFor({operation});
  const executionIds = text.trim().split(/[\s,;]+/).filter(Boolean);
  if (!executionIds.length) throw new ReplayError('bulk_selection_invalid');
  for (const executionId of executionIds) validateIds(workflowId, executionId, config);
  if (new Set(executionIds).size !== executionIds.length) throw new ReplayError('bulk_duplicate');
  return executionIds.map(executionId => ({workflowId, executionId, ...(operation === 'retry' ? {operation} : {})}));
}

async function inspectSelection({selection, api, storage, locks, config, now = Date.now, onProgress = () => {}}, retain = false) {
  if (!Array.isArray(selection) || !selection.length || selection.some(ids => ids.workflowId !== selection[0].workflowId || operationFor(ids) !== operationFor(selection[0]))) throw new ReplayError('bulk_selection_invalid');
  selection = parseSelection(selection[0].workflowId, selection.map(ids => ids.executionId).join(' '), config, operationFor(selection[0]));
  const user = await api.user();
  if (typeof user?.id !== 'string' || !user.id) throw new ReplayError('invalid_response');
  const rows = [], entries = [];
  const concurrency = Math.max(1, Math.min(8, Number.isInteger(config.previewConcurrency) ? config.previewConcurrency : 4));
  let previewing = true;
  const pendingReads = new Map();
  function sharedRead(method, ...args) {
    if (!previewing) return api[method](...args);
    const key = JSON.stringify([method, ...args]);
    if (!pendingReads.has(key)) {
      const request = Promise.resolve().then(() => api[method](...args)).finally(() => pendingReads.delete(key));
      pendingReads.set(key, request);
    }
    return pendingReads.get(key);
  }
  const previewApi = {
    user: () => sharedRead('user'), workflow: id => sharedRead('workflow', id),
    execution: id => api.execution(id), run: (...args) => api.run(...args), retry: id => api.retry(id),
  };
  let targetVersion = null, targetDefinition = null;
  async function inspect(ids, index) {
    const manager = createManager({api: previewApi, storage, locks, config, now});
    let kept = false;
    try {
      const {user: current, plan, record} = await manager.preview(ids);
      if (current.id !== user.id) throw new ReplayError('session_changed');
      if (targetVersion !== null && targetVersion !== plan.versionId) throw new ReplayError('preview_changed');
      const definition = JSON.stringify(plan.workflowSnapshot);
      if (targetDefinition !== null && targetDefinition !== definition) throw new ReplayError('preview_changed');
      targetVersion = plan.versionId;
      targetDefinition = definition;
      rows[index] = {executionId: ids.executionId, workflowName: plan.workflowName, versionId: plan.versionId,
        trigger: plan.trigger, triggerType: plan.triggerType, operation: plan.operation ?? 'replay', itemCount: plan.itemCount, code: record ? 'existing_reservation' : 'compatible'};
      if (retain && !record) { entries[index] = {ids, manager}; kept = true; }
    } catch (error) {
      if (['session_changed', 'session_expired', 'open_editor_first', 'preview_changed'].includes(error.code)) {
        entries.forEach(entry => entry.manager.clearApproval()); throw error;
      }
      rows[index] = {executionId: ids.executionId, code: error.code ?? 'invalid_response'};
    } finally { if (!kept) manager.clearApproval(); }
  }
  try {
    for (let start = 0; start < selection.length; start += concurrency) {
      // Wait for every read in the wave before cleanup or launching another wave.
      const results = await Promise.allSettled(selection.slice(start, start + concurrency).map((ids, offset) => inspect(ids, start + offset)));
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
      onProgress([...rows]);
    }
    if ((await api.user()).id !== user.id) throw new ReplayError('session_changed');
    if (targetVersion !== null) {
      const workflow = await api.workflow(selection[0].workflowId);
      if (!Array.isArray(workflow.scopes) || !['workflow:read', 'workflow:execute'].every(scope => workflow.scopes.includes(scope))) throw new ReplayError('workflow_scope_missing');
      if (workflow.versionId !== targetVersion || JSON.stringify({nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings}) !== targetDefinition || Object.keys(workflow.pinData ?? {}).length) throw new ReplayError('preview_changed');
    }
    if ((await api.user()).id !== user.id) throw new ReplayError('session_changed');
    return {rows, entries: entries.filter(Boolean), userId: user.id, selection};
  } catch (error) { entries.forEach(entry => entry.manager.clearApproval()); throw error; }
  finally { previewing = false; pendingReads.clear(); }
}

export async function prepareSelection(options) { return (await inspectSelection(options)).rows; }

export function createBulkManager(options) {
  const now = options.now ?? Date.now;
  let approval = null, active = false, stopRequested = false;
  const clear = () => { approval?.entries.forEach(entry => entry.manager.clearApproval()); approval = null; };
  return {
    clearApproval: clear,
    stop() { if (active) stopRequested = true; },
    async preview(selection, onProgress = () => {}) {
      if (active) throw new ReplayError('another_operation_busy');
      clear(); active = true;
      const time = now();
      try {
        const batch = await inspectSelection({...options, selection, onProgress}, true);
        const runnable = batch.rows.every(row => row.code === 'compatible');
        if (runnable) approval = {...batch, time};
        else batch.entries.forEach(entry => entry.manager.clearApproval());
        return {rows: batch.rows, runnable};
      } finally { active = false; }
    },
    async submit(selection, confirmed, onProgress = () => {}, largeBatchConfirmed = false) {
      if (active) throw new ReplayError('another_operation_busy');
      const batch = approval; approval = null;
      if (!confirmed || !batch || now() - batch.time > 5 * 60000 || JSON.stringify(selection) !== JSON.stringify(batch.selection)) {
        batch?.entries.forEach(entry => entry.manager.clearApproval()); throw new ReplayError('preview_required');
      }
      if (batch.selection.length > 50 && largeBatchConfirmed !== true) {
        batch.entries.forEach(entry => entry.manager.clearApproval());
        throw new ReplayError('large_batch_confirmation_required');
      }
      active = true; stopRequested = false;
      const rows = batch.rows.map(row => ({...row, status: 'not_sent'}));
      let reason = 'complete';
      try {
        for (let index = 0; index < batch.entries.length; index++) {
          if (stopRequested) { reason = 'stopped'; break; }
          const {ids, manager} = batch.entries[index];
          rows[index].status = 'sending'; onProgress(structuredClone(rows));
          try {
            const record = await manager.submit(ids, true);
            rows[index] = {...rows[index], status: 'submitted', resultExecutionId: record.executionId};
            if (record.operation === 'retry' && record.resultStatus !== 'success') {
              reason = 'retry_not_successful'; onProgress(structuredClone(rows)); break;
            }
          } catch (error) {
            rows[index] = {...rows[index], status: 'blocked', code: error.code ?? 'outcome_unknown'};
            reason = 'error'; onProgress(structuredClone(rows)); break;
          }
          onProgress(structuredClone(rows));
        }
        return {rows, reason};
      } finally {
        batch.entries.forEach(entry => entry.manager.clearApproval()); active = false;
      }
    },
  };
}
