import { ReplayError } from './model.mjs';

export async function workflowPage(api, config, skip = 0, name = '') {
  const user = await api.user();
  if (typeof user?.id !== 'string' || !user.id) throw new ReplayError('invalid_response');
  const response = await api.workflows({skip, name});
  if ((await api.user()).id !== user.id) throw new ReplayError('session_changed');
  if (!Array.isArray(response?.data) || response.data.length > 100 || !Number.isSafeInteger(response.count) || response.count < 0) throw new ReplayError('invalid_response');
  const workflows = response.data.map(workflow => {
    if (typeof workflow?.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(workflow.id) || typeof workflow.name !== 'string' || !Array.isArray(workflow.scopes)) throw new ReplayError('invalid_response');
    const configured = config.discoverWorkflows || Object.hasOwn(config.workflows, workflow.id);
    const permitted = ['workflow:read', 'workflow:execute'].every(scope => workflow.scopes.includes(scope));
    return {id: workflow.id, name: workflow.name, selectable: configured && permitted && !workflow.isArchived,
      reason: !configured ? 'Workflow non configuré pour le rejeu' : !permitted ? 'Droits de rejeu insuffisants' : workflow.isArchived ? 'Workflow archivé' : ''};
  });
  return {userId: user.id, workflows, nextSkip: workflows.length && skip + workflows.length < response.count ? skip + workflows.length : null};
}
