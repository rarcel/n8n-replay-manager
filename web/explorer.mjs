import { ReplayError, validateIds } from './model.mjs';

const dateValue = value => {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new ReplayError('invalid_filter');
  return new Date(value).toISOString();
};
export function executionQuery({workflowId, status = 'terminal', startedAfter, startedBefore, cursor} = {}) {
  if (typeof workflowId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(workflowId) || !['terminal', 'success', 'error'].includes(status)) throw new ReplayError('invalid_filter');
  const filter = {workflowId, status: status === 'terminal' ? ['success', 'error'] : [status]};
  const after = dateValue(startedAfter), before = dateValue(startedBefore);
  if (after && before && after > before) throw new ReplayError('invalid_filter');
  if (after) filter.startedAfter = after;
  if (before) filter.startedBefore = before;
  const query = new URLSearchParams({limit: '50', filter: JSON.stringify(filter)});
  if (cursor !== undefined && cursor !== null) {
    if (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(cursor)) throw new ReplayError('invalid_response');
    query.set('cursor', cursor);
  }
  return query;
}

export function localDateToIso(value) {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) throw new ReplayError('invalid_filter');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new ReplayError('invalid_filter');
  return date.toISOString();
}

function executionPage(response, filters) {
  if (!Array.isArray(response?.results) || response.results.length > 50 || !Number.isSafeInteger(response.count) || response.count < -1 || typeof response.estimated !== 'boolean' ||
      !(response.nextCursor === null || typeof response.nextCursor === 'string' && /^[A-Za-z0-9_-]{1,2048}$/.test(response.nextCursor))) throw new ReplayError('invalid_response');
  const {filter: raw} = Object.fromEntries(executionQuery(filters));
  const filter = JSON.parse(raw);
  const seen = new Set();
  const rows = response.results.map(row => {
    if (typeof row?.id !== 'string' || !row.id || row.id.length > 80 || seen.has(row.id) || row.workflowId !== filters.workflowId || !filter.status.includes(row.status) ||
        !(row.startedAt === null || typeof row.startedAt === 'string' && Number.isFinite(Date.parse(row.startedAt))) ||
        (row.stoppedAt != null && (typeof row.stoppedAt !== 'string' || !Number.isFinite(Date.parse(row.stoppedAt))))) throw new ReplayError('invalid_response');
    seen.add(row.id);
    if ((filter.startedAfter || filter.startedBefore) && (!row.startedAt ||
        filter.startedAfter && Date.parse(row.startedAt) < Date.parse(filter.startedAfter) ||
        filter.startedBefore && Date.parse(row.startedAt) > Date.parse(filter.startedBefore))) throw new ReplayError('invalid_response');
    const supportedId = /^[0-9]{1,30}$/.test(row.id);
    const permitted = Array.isArray(row.scopes) && ['workflow:read', 'workflow:execute'].every(scope => row.scopes.includes(scope));
    return {id: row.id, status: row.status, startedAt: row.startedAt, stoppedAt: row.stoppedAt ?? null,
      selectable: supportedId && !!row.stoppedAt && permitted,
      reason: !supportedId ? 'Format d’ID non pris en charge' : !row.stoppedAt ? 'Source non terminée' : !permitted ? 'Droits insuffisants' : ''};
  });
  return {rows, count: response.count, estimated: response.estimated, nextCursor: response.nextCursor};
}

export function createExplorer({api, config}) {
  let filters = null, userId = null, cursor = null, loading = false;
  let page = null;
  const selected = new Map(), known = new Map(), cursors = new Set();
  function clear() { filters = null; userId = null; cursor = null; page = null; selected.clear(); known.clear(); cursors.clear(); }
  async function load(nextFilters, more) {
    if (loading) throw new ReplayError('another_operation_busy');
    if (more && (!filters || cursor === null)) throw new ReplayError('invalid_filter');
    if (!more) clear();
    loading = true;
    try {
      const queryFilters = more ? filters : {...nextFilters};
      validateIds(queryFilters.workflowId, '1', config); executionQuery(queryFilters);
      const user = await api.user();
      if (typeof user?.id !== 'string' || !user.id) throw new ReplayError('invalid_response');
      if (more && user.id !== userId) throw new ReplayError('session_changed');
      const result = executionPage(await api.executions({...queryFilters, cursor: more ? cursor : undefined}), queryFilters);
      if ((await api.user()).id !== user.id) throw new ReplayError('session_changed');
      if (result.nextCursor !== null && (result.nextCursor === cursor || cursors.has(result.nextCursor))) throw new ReplayError('invalid_response');
      if (result.nextCursor !== null) cursors.add(result.nextCursor);
      for (const row of result.rows) {
        if (known.has(row.id)) throw new ReplayError('invalid_response');
        known.set(row.id, row);
      }
      filters = queryFilters; userId = user.id; cursor = result.nextCursor; page = result;
      return result;
    } catch (error) { clear(); throw error; }
    finally { loading = false; }
  }
  return {
    reset: clear,
    search: nextFilters => load(nextFilters, false),
    more: () => load(null, true),
    selection: () => [...selected.keys()],
    select(id, checked) {
      if (loading) throw new ReplayError('another_operation_busy');
      if (!known.get(id)?.selectable) throw new ReplayError('bulk_selection_invalid');
      if (checked && !selected.has(id) && selected.size >= 50) throw new ReplayError('bulk_selection_invalid');
      if (checked) selected.set(id, true); else selected.delete(id);
    },
    clearSelection() { selected.clear(); },
    get page() { return page; },
  };
}
