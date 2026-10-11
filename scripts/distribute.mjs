import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

function run(command, args, inherit = false) {
  const result = spawnSync(command, args, {encoding: 'utf8', ...(inherit ? {stdio: 'inherit'} : {})});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `${command} failed`);
  return result.stdout;
}
if (run('git', ['status', '--porcelain', '--untracked-files=normal']).trim()) {
  throw new Error('Commit or save your changes before packaging. The archive uses committed files only.');
}
run(process.execPath, ['scripts/validate.mjs'], true);
const {name, version} = JSON.parse(readFileSync('package.json', 'utf8'));
if (!/^[a-z0-9-]+$/.test(name) || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid package name or version');
mkdirSync('dist', {recursive: true});
const filename = `${name}-${version}.zip`, target = resolve('dist', filename);
run('git', ['archive', '--format=zip', `--prefix=${name}/`, `--output=${target}`, 'HEAD']);
const hash = createHash('sha256').update(readFileSync(target)).digest('hex');
writeFileSync(`${target}.sha256`, `${hash}  ${filename}\n`);
console.log(`Distribution: ${target}\nSHA-256: ${hash}`);
