// Local UI fixtures only. No forwarding, real n8n session or replay endpoint.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { config } from '../web/config.mjs';
import { stringify } from '../web/vendor/flatted.mjs';
const root = resolve('web');
const types = {'.html': 'text/html; charset=utf-8', '.css': 'text/css', '.mjs': 'application/javascript', '.woff2': 'font/woff2'};
const workflow = {id: config.defaultWorkflowId, name: 'Workflow factice <test>', versionId: 'fixture-v1', scopes: ['workflow:read', 'workflow:execute'], nodes: [{name: 'Webhook', type: 'n8n-nodes-base.webhook'}], connections: {}, settings: {}};
const summaries = ['101', '102', '103'].map((id, index) => ({id, workflowId: workflow.id, status: index === 1 ? 'success' : 'error', startedAt: `2026-10-${String(10 - index).padStart(2, '0')}T12:00:00.000Z`, stoppedAt: `2026-10-${String(10 - index).padStart(2, '0')}T12:01:00.000Z`, scopes: workflow.scopes}));
let rejectedWrites = 0;
const simulateRuns = process.env.FIXTURE_RUNS === '1';
const simulatedResults = new Map();
let simulatedPosts = 0;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const json = (value, status = 200) => {res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(value));};
  if (simulateRuns && req.method === 'POST' && url.pathname === `/rest/workflows/${workflow.id}/run`) {
    let size = 0, raw = '';
    for await (const chunk of req) { size += chunk.length; if (size > 2 * 1024 * 1024) return json({error: 'Too large'}, 413); raw += chunk; }
    let payload;
    try { payload = JSON.parse(raw); } catch {return json({error: 'Invalid fixture payload'}, 400);}
    if (!payload.triggerToStartFrom?.data?.data?.main?.[0]?.[0]?.json?.body?.fixture) return json({error: 'Only fixture data accepted'}, 400);
    const executionId = String(1000 + ++simulatedPosts);
    simulatedResults.set(executionId, {id: executionId, workflowId: workflow.id, mode: 'manual', status: 'success', stoppedAt: '2026-10-11T12:00:00Z'});
    await new Promise(resolve => setTimeout(resolve, 400));
    return json({data: {executionId}});
  }
  if (req.method !== 'GET') { rejectedWrites++; return json({error: 'Fixtures: all writes refused'}, 405); }
  if (url.pathname === '/fixture-stats') return json({rejectedWrites, simulatedPosts});
  if (url.pathname === '/rest/login') return json({data: {id: 'fixture-user', firstName: 'Session factice'}});
  if (url.pathname === '/rest/workflows') {
    let filter;
    try { filter = JSON.parse(url.searchParams.get('filter') ?? '{}'); } catch { return json({error: 'Invalid filter'}, 400); }
    const rows = [workflow, {...workflow, id: 'not-configured', name: 'Autre workflow factice'}].filter(row => row.name.toLowerCase().includes((filter.name ?? '').toLowerCase()));
    const skip = Number(url.searchParams.get('skip') ?? 0);
    return json({count: rows.length, data: rows.slice(skip, skip + 100)});
  }
  if (url.pathname === `/rest/workflows/${workflow.id}`) return json({data: workflow});
  if (url.pathname === '/rest/executions') {
    let filter;
    try { filter = JSON.parse(url.searchParams.get('filter')); } catch { return json({error: 'Invalid filter'}, 400); }
    const rows = summaries.filter(row => row.workflowId === filter.workflowId && filter.status.includes(row.status) &&
      (!filter.startedAfter || row.startedAt >= filter.startedAfter) && (!filter.startedBefore || row.startedAt <= filter.startedBefore));
    const offset = url.searchParams.has('cursor') ? 2 : 0;
    return json({data: {results: rows.slice(offset, offset + 2), nextCursor: rows.length > offset + 2 ? 'fixture_next' : null, count: rows.length, estimated: false}});
  }
  const executionId = url.pathname.match(/^\/rest\/executions\/(\d+)$/)?.[1];
  if (executionId) {
    if (simulatedResults.has(executionId)) return json({data: simulatedResults.get(executionId)});
    const summary = summaries.find(row => row.id === executionId);
    if (!summary) return json({error: 'Fixture not found'}, 404);
    return json({data: {...summary, mode: 'webhook', finished: summary.status === 'success', data: stringify({resultData: {runData: {Webhook: [{startTime: 1791633600000, executionTime: 12, executionStatus: 'success', data: {main: [[{json: {body: {fixture: true}}}]]}}]}}})}});
  }
  if (!url.pathname.startsWith('/replay-manager/')) return json({error: 'Fixtures only'}, 404);
  const target = resolve(root, '.' + url.pathname.slice('/replay-manager'.length) + (url.pathname.endsWith('/') ? 'index.html' : ''));
  if (!target.startsWith(root + sep)) return json({error: 'Not found'}, 404);
  try {
    let body = await readFile(target);
    if (target === resolve(root, 'app.mjs')) {
      // Synthetic header lives only in this test adapter; never write a browser ID.
      body = Buffer.from(body.toString().replace('createApi({storage: localStorage})', "createApi({storage: {getItem: () => '00000000-0000-4000-8000-000000000001'}})"));
    }
    res.writeHead(200, {'Content-Type': types[extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}); res.end(body);
  } catch { json({error: 'Not found'}, 404); }
});
server.listen(8090, '127.0.0.1', () => console.log(`Fixtures only: http://127.0.0.1:8090/replay-manager/ — ${simulateRuns ? 'simulated POSTs only, no n8n connection' : 'all writes refused'}`));
process.on('SIGTERM', () => server.close(() => console.log(`Rejected writes: ${rejectedWrites}`)));
