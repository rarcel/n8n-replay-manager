import { ReplayError, validateIds } from './model.mjs';
import { createManager } from './client.mjs';

// Preparation only: each temporary manager discards its approval and payload.
export function parseSelection(workflowId, text, config) {
  const executionIds = text.trim().split(/[\s,;]+/).filter(Boolean);
  if (!executionIds.length || executionIds.length > 50) throw new ReplayError('bulk_selection_invalid');
  for (const executionId of executionIds) validateIds(workflowId, executionId, config);
  if (new Set(executionIds).size !== executionIds.length) throw new ReplayError('bulk_duplicate');
  return executionIds.map(executionId => ({workflowId, executionId}));
}

export async function prepareSelection({selection, api, storage, locks, config, onProgress = () => {}}) {
  if (!Array.isArray(selection) || !selection.length || selection.some(ids => ids.workflowId !== selection[0].workflowId)) throw new ReplayError('bulk_selection_invalid');
  selection = parseSelection(selection[0].workflowId, selection.map(ids => ids.executionId).join(' '), config);
  const user = await api.user();
  if (typeof user?.id !== 'string' || !user.id) throw new ReplayError('invalid_response');
  const rows = [];
  let targetVersion = null, targetDefinition = null;
  for (const ids of selection) {
    const manager = createManager({api, storage, locks, config});
    try {
      const {user: current, plan, record} = await manager.preview(ids);
      if (current.id !== user.id) throw new ReplayError('session_changed');
      if (targetVersion !== null && targetVersion !== plan.versionId) throw new ReplayError('preview_changed');
      const definition = JSON.stringify(plan.workflowSnapshot);
      if (targetDefinition !== null && targetDefinition !== definition) throw new ReplayError('preview_changed');
      targetVersion = plan.versionId;
      targetDefinition = definition;
      rows.push({executionId: ids.executionId, workflowName: plan.workflowName, versionId: plan.versionId,
        itemCount: plan.itemCount, code: record ? 'existing_reservation' : 'compatible'});
    } catch (error) {
      if (['session_changed', 'session_expired', 'open_editor_first', 'preview_changed'].includes(error.code)) throw error;
      rows.push({executionId: ids.executionId, code: error.code ?? 'invalid_response'});
    } finally { manager.clearApproval(); }
    onProgress([...rows]);
  }
  if ((await api.user()).id !== user.id) throw new ReplayError('session_changed');
  return rows;
}
