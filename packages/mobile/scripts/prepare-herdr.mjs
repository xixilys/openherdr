import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(mobileRoot, '../web/dist-herdr');
const target = resolve(mobileRoot, 'openherdr/dist');

if (!existsSync(resolve(source, 'herdr.html'))) {
  throw new Error('OpenHerdr web assets are missing. Run bun run build:herdr from the repository root first.');
}

mkdirSync(dirname(target), { recursive: true });
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
renameSync(resolve(target, 'herdr.html'), resolve(target, 'index.html'));
console.log(`OpenHerdr native assets prepared in ${target}`);
