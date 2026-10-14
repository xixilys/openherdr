import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = resolve(mobileRoot, 'openherdr');
const cap = resolve(mobileRoot, 'node_modules/@capacitor/cli/bin/capacitor');

function run(command, args, cwd = appRoot) {
  const result = spawnSync(command, args, { cwd, env: process.env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with ${result.status ?? result.signal}`);
}

if (process.platform !== 'darwin') throw new Error('The iOS build requires macOS and Xcode.');
run(process.execPath, [resolve(mobileRoot, 'scripts/prepare-herdr.mjs')]);
if (!existsSync(resolve(appRoot, 'ios/App/App.xcodeproj'))) run(process.execPath, [cap, 'add', 'ios']);
run(process.execPath, [cap, 'sync', 'ios']);
run('xcodebuild', [
  '-project', 'ios/App/App.xcodeproj',
  '-scheme', 'App',
  '-configuration', 'Debug',
  '-sdk', 'iphonesimulator',
  '-destination', 'generic/platform=iOS Simulator',
  '-packageAuthorizationProvider', 'netrc',
  '-derivedDataPath', 'build/ios-simulator',
  'CODE_SIGNING_ALLOWED=NO',
  'build',
]);
console.log(`OpenHerdr simulator app: ${resolve(appRoot, 'build/ios-simulator/Build/Products/Debug-iphonesimulator/App.app')}`);
