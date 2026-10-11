import { ReplayError, prepareReplay, digestPlan, validateIds } from './model.mjs';
export function readBrowserId(storage) {
  let id;
  try { id = storage.getItem('n8n-browserId'); } catch { throw new ReplayError('storage_unavailable'); }
  // Reuse n8n's existing identifier; never generate or overwrite it.
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{16,200}$/.test(id)) throw new ReplayError('open_editor_first');
  return id;
}
export function createApi({storage, fetchImpl = fetch, origin = location.origin}) {
  async function request(path, payload) {
    if (!/^\/rest\/(login|executions\/[0-9]{1,30}|workflows\/[A-Za-z0-9_-]{1,80}(\/run)?)$/.test(path)) throw new ReplayError('invalid_path');
    const post = payload !== undefined;
    const headers = {Accept: 'application/json', 'browser-id': readBrowserId(storage)};
    if (post) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetchImpl(new URL(path, origin), {method: post ? 'POST' : 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store', headers,
        signal: AbortSignal.timeout(post ? 60000 : 20000), ...(post ? {body: JSON.stringify(payload)} : {})});
    } catch { throw new ReplayError(post ? 'outcome_unknown' : 'network_error'); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ReplayError(response.status === 401 ? 'session_expired' : response.status === 403 || response.status === 404 ? 'access_denied' : post ? 'outcome_unknown' : 'upstream_error');
    }
    if (!(response.headers.get('content-type') ?? '').includes('application/json')) {
      await response.body?.cancel(); throw new ReplayError(post ? 'outcome_unknown' : 'invalid_response');
    }
    try {
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      try {
        while (true) { const {done, value} = await reader.read(); if (done) break; size += value.length; if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new Error(); } chunks.push(value); }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const envelope = JSON.parse(new TextDecoder().decode(bytes));
      if (!envelope || !Object.hasOwn(envelope, 'data') || envelope.data === null || typeof envelope.data !== 'object') throw new Error();
      return envelope.data;
    } catch { throw new ReplayError(post ? 'outcome_unknown' : 'invalid_response'); }
  }
  return {
    user: () => request('/rest/login'), // GET only; no login credentials collected.
    execution: id => request(`/rest/executions/${id}`),
    workflow: id => request(`/rest/workflows/${id}`),
    run: (id, payload) => request(`/rest/workflows/${id}/run`, payload),
  };
}
const keyFor = (userId, ids) => 'replay-manager:v2:' + JSON.stringify([userId, ids.workflowId, ids.executionId]);
export function createManager({api, storage, locks, config, digest = digestPlan}) {
  let approved = null;
  const read = key => { try { const raw = storage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { throw new ReplayError('storage_unavailable'); } };
  const write = (key, value) => { try { storage.setItem(key, JSON.stringify(value)); } catch { throw new ReplayError('storage_unavailable'); } };
  const identity = async () => { const user = await api.user(); if (typeof user?.id !== 'string' || !user.id) throw new ReplayError('invalid_response'); return user; };
  const load = async ids => { validateIds(ids.workflowId, ids.executionId, config); return prepareReplay(await api.execution(ids.executionId), await api.workflow(ids.workflowId), ids, config); };
  async function locked(user, ids, callback) {
    if (!locks?.request) throw new ReplayError('locks_unavailable');
    return locks.request(keyFor(user.id, ids), {mode: 'exclusive', ifAvailable: true}, async lock => {
      if (!lock) throw new ReplayError('another_tab_busy');
      return callback(keyFor(user.id, ids));
    });
  }
  return {
    clearApproval() { approved = null; },
    async session() { return identity(); },
    async preview(ids) {
      approved = null;
      const user = await identity();
      const plan = await load(ids);
      const digestValue = await digest(plan);
      approved = {userId: user.id, ids: {...ids}, plan, digest: digestValue, time: Date.now()};
      return {user, plan, record: read(keyFor(user.id, ids))};
    },
    async submit(ids, confirmed) {
      const approval = approved;
      approved = null; // A failed or ambiguous submission must be previewed again.
      if (!confirmed || !approval || JSON.stringify(ids) !== JSON.stringify(approval.ids) || Date.now() - approval.time > 5 * 60000) throw new ReplayError('preview_required');
      const user = await identity();
      if (user.id !== approval.userId) throw new ReplayError('session_changed');
      return locked(user, ids, async key => {
        if (read(key)) throw new ReplayError('existing_reservation');
        const fresh = await load(ids);
        if (await digest(fresh) !== approval.digest) throw new ReplayError('preview_changed');
        if ((await identity()).id !== user.id) throw new ReplayError('session_changed');
        // Durable browser-local marker precedes POST; no Cookie/API key is persisted.
        const record = {userId: user.id, workflowId: ids.workflowId, sourceExecutionId: ids.executionId, time: new Date().toISOString(), status: 'pending'};
        write(key, record);
        let result;
        try { result = await api.run(ids.workflowId, fresh.payload); }
        catch (error) { write(key, {...record, status: 'unknown'}); throw error; }
        if (result?.waitingForWebhook) { write(key, {...record, status: 'waitingForWebhook'}); throw new ReplayError('waiting_for_webhook'); }
        if (!/^[0-9]{1,30}$/.test(String(result?.executionId ?? ''))) { write(key, {...record, status: 'unknown'}); throw new ReplayError('outcome_unknown'); }
        const completed = {...record, status: 'submitted', executionId: String(result.executionId)};
        write(key, completed);
        return completed;
      });
    },
    async getRecord(ids) { const user = await identity(); return read(keyFor(user.id, ids)); },
    async release(ids, acknowledged) {
      approved = null;
      if (!acknowledged) throw new ReplayError('acknowledgement_required');
      const user = await identity();
      await locked(user, ids, async key => { try { storage.removeItem(key); } catch { throw new ReplayError('storage_unavailable'); } });
    },
    async check(ids) {
      const user = await identity(); const record = read(keyFor(user.id, ids));
      if (!record?.executionId || !/^[0-9]{1,30}$/.test(record.executionId)) throw new ReplayError('no_result');
      const execution = await api.execution(record.executionId);
      if (String(execution?.id) !== record.executionId || execution.workflowId !== ids.workflowId || execution.mode !== 'manual') throw new ReplayError('result_mismatch');
      return {id: record.executionId, status: execution.status, finished: execution.finished, stoppedAt: execution.stoppedAt};
    },
  };
}
