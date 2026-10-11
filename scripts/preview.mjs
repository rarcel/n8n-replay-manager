import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve('web');
const types = {'.html': 'text/html; charset=utf-8', '.css': 'text/css', '.mjs': 'application/javascript'};
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/' || path === '/replay-manager') { res.writeHead(302, {Location: '/replay-manager/'}); return res.end(); }
  if (!['GET', 'HEAD'].includes(req.method) || !path.startsWith('/replay-manager/')) { res.writeHead(503, {'Content-Type': 'application/json'}); return res.end(JSON.stringify({error: 'Preview only. No n8n backend or replay available.'})); }
  const target = resolve(root, '.' + path.slice('/replay-manager'.length) + (path.endsWith('/') ? 'index.html' : ''));
  if (!target.startsWith(root + sep)) { res.writeHead(404); return res.end(); }
  try { const body = await readFile(target); res.writeHead(200, {'Content-Type': types[extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}); res.end(req.method === 'HEAD' ? undefined : body); }
  catch { res.writeHead(404); res.end(); }
});
server.listen(Number(process.env.PORT ?? 8088), '127.0.0.1', () => console.log(`Local preview: http://127.0.0.1:${server.address().port}/replay-manager/ (no n8n calls possible)`));
process.on('SIGTERM', () => server.close());
