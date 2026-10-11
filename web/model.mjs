import { parse as parseFlatted } from './vendor/flatted.mjs';
export class ReplayError extends Error {
  constructor(code, versions) { super(code); this.code = code; this.versions = versions; }
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const replayTriggerTypes = Object.freeze(['n8n-nodes-base.webhook', 'n8n-nodes-base.scheduleTrigger', 'n8n-nodes-base.manualTrigger']);
export function validateIds(workflowId, executionId, config) {
  if (typeof workflowId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(workflowId) ||
      typeof executionId !== 'string' || !/^[0-9]{1,30}$/.test(executionId)) throw new ReplayError('invalid_ids');
  if (!config.discoverWorkflows && !Object.hasOwn(config.workflows, workflowId)) throw new ReplayError('workflow_not_configured');
}
export function normalizeExecution(execution) {
  if (!object(execution) || execution.dataTooLargeToDisplay) throw new ReplayError('execution_unavailable');
  let data = execution.data;
  if (typeof data === 'string') {
    if (new TextEncoder().encode(data).length > 8 * 1024 * 1024) throw new ReplayError('data_too_large');
    try { data = parseFlatted(data); } catch { throw new ReplayError('invalid_execution_data'); }
  }
  if (!object(data) || !object(data.resultData)) throw new ReplayError('invalid_execution_data');
  if (data.redactionInfo?.isRedacted) throw new ReplayError('redacted_data');
  return {...execution, data};
}
export function prepareReplay(rawExecution, workflow, ids, config) {
  validateIds(ids.workflowId, ids.executionId, config);
  const execution = normalizeExecution(rawExecution);
  if (String(execution.id) !== ids.executionId || execution.workflowId !== ids.workflowId || workflow?.id !== ids.workflowId) throw new ReplayError('workflow_mismatch');
  // n8n error executions may have finished=false; stoppedAt plus terminal status is required.
  if (!['success', 'error'].includes(execution.status) || !execution.stoppedAt) throw new ReplayError('source_not_terminal');
  if (!Array.isArray(workflow.scopes) || !workflow.scopes.includes('workflow:read') || !workflow.scopes.includes('workflow:execute')) throw new ReplayError('workflow_scope_missing');
  const sourceVersion = execution.workflowData?.versionId;
  const currentVersion = workflow.versionId;
  const versions = {source: typeof sourceVersion === 'string' ? sourceVersion.slice(0, 80) : null, current: typeof currentVersion === 'string' ? currentVersion.slice(0, 80) : null};
  // Replay source data into the current stored workflow, never its historical snapshot.
  if (typeof currentVersion !== 'string' || !currentVersion) throw new ReplayError('workflow_version_unavailable', versions);
  if (Object.keys(workflow.pinData ?? {}).length) throw new ReplayError('pinned_data');
  const configuredTrigger = config.workflows[ids.workflowId]?.trigger;
  const candidates = workflow.nodes?.filter(node => replayTriggerTypes.includes(node.type) &&
    (configuredTrigger ? node.name === configuredTrigger : Object.hasOwn(execution.data.resultData.runData ?? {}, node.name))) ?? [];
  if (candidates.length > 1) throw new ReplayError('ambiguous_trigger');
  const node = candidates[0];
  if (!node || node.disabled) throw new ReplayError('unsupported_trigger');
  const trigger = node.name;
  const historicalNode = execution.workflowData?.nodes?.find(sourceNode => sourceNode.name === trigger);
  if (historicalNode && historicalNode.type !== node.type) throw new ReplayError('unsupported_trigger');
  const runs = execution.data.resultData.runData?.[trigger];
  if (!Array.isArray(runs) || runs.length !== 1 || runs[0]?.error || runs[0]?.redactedError) throw new ReplayError('ambiguous_trigger');
  const task = runs[0];
  if (!Number.isFinite(task.startTime) || task.startTime < 0 || !Number.isFinite(task.executionTime) || task.executionTime < 0 ||
      (task.executionStatus !== undefined && task.executionStatus !== 'success')) throw new ReplayError('unsupported_task_metadata');
  const data = runs[0].data;
  if (!object(data) || Object.keys(data).some(k => k !== 'main') || !Array.isArray(data.main) || data.main.length !== 1 ||
      !Array.isArray(data.main[0]) || !data.main[0].length || data.main[0].length > 1000) throw new ReplayError('unsupported_data');
  if (data.main[0].some(item => item?.redaction?.redacted)) throw new ReplayError('redacted_data');
  if (data.main[0].some(item => !object(item) || !object(item.json) || Object.hasOwn(item, 'binary') || item.error)) throw new ReplayError('unsupported_data');
  let items;
  try { items = JSON.parse(JSON.stringify(data.main[0].map(item => ({json: item.json})))); } catch { throw new ReplayError('unsupported_data'); }
  // n8n expects ITaskData, not ITaskDataConnections. The engine reads .data.data.
  const triggerTask = {startTime: task.startTime, executionTime: task.executionTime, executionStatus: 'success', source: [], data: {main: [items]}};
  if (Number.isSafeInteger(task.executionIndex) && task.executionIndex >= 0) triggerTask.executionIndex = task.executionIndex;
  const payload = {triggerToStartFrom: {name: trigger, data: triggerTask}};
  const bytes = new TextEncoder().encode(JSON.stringify(payload)).length;
  if (bytes > 2 * 1024 * 1024) throw new ReplayError('payload_too_large');
  const workflowSnapshot = JSON.parse(JSON.stringify({nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings}));
  return {workflowId: ids.workflowId, sourceExecutionId: ids.executionId, workflowName: String(workflow.name ?? workflow.id), versionId: currentVersion, sourceVersionId: versions.source, replayTarget: 'current', workflowSnapshot, trigger, triggerType: node.type, itemCount: items.length, payload};
}
export async function digestPlan(plan, subtle = globalThis.crypto.subtle) {
  const text = JSON.stringify([plan.workflowId, plan.sourceExecutionId, plan.versionId, plan.replayTarget, plan.workflowSnapshot, plan.payload]);
  const bytes = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
