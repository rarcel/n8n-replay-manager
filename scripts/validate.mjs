import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const vendor = createHash('sha256').update(readFileSync('web/vendor/flatted.mjs')).digest('hex');
if (vendor !== 'd697ad948769363b99110e1bffe84269a7e74955b42e4e74abac61b02f6c9de6') throw new Error('Unexpected flatted artifact');
for (const dir of ['web', 'scripts', 'test']) {
  for (const name of readdirSync(dir).filter(n => n.endsWith('.mjs'))) {
    const result = spawnSync(process.execPath, ['--check', `${dir}/${name}`], {stdio: 'inherit'});
    if (result.status !== 0) process.exit(1);
  }
}
const result = spawnSync(process.execPath, ['--test'], {stdio: 'inherit'});
process.exit(result.status ?? 1);
