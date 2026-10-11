import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { config } from '../web/config.mjs';

test('distribution defaults contain no preselected installation IDs and use documented placeholders', () => {
  assert.equal(Object.hasOwn(config, 'defaultWorkflowId'), false);
  assert.equal(Object.hasOwn(config, 'defaultExecutionId'), false);
  assert.deepEqual(config.workflows, {});
  const env = readFileSync('deploy/traefik.env.example', 'utf8');
  assert.ok(env.includes('N8N_PUBLIC_HOST=n8n.example.com'));
  assert.ok(env.includes('TRAEFIK_NETWORK=traefik-public'));
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.name, 'n8n-replay-manager'); assert.equal(pkg.license, 'Apache-2.0');
  assert.ok(readFileSync('LICENSE', 'utf8').includes('Apache License'));
  const attributes = readFileSync('.gitattributes', 'utf8');
  for (const name of ['AGENTS.md', 'HANDOFF.md', 'previews/']) assert.ok(attributes.includes(`${name} export-ignore`));
});
