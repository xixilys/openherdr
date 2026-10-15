import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = resolve(mobileRoot, 'openherdr');
const cap = resolve(mobileRoot, 'node_modules/@capacitor/cli/bin/capacitor');

function run(command, args) {
  const env = {
    ...process.env,
    PATH: process.env.JAVA_HOME ? `${resolve(process.env.JAVA_HOME, 'bin')}:${process.env.PATH || ''}` : process.env.PATH,
  };
  const result = spawnSync(command, args, { cwd: appRoot, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with ${result.status ?? result.signal}`);
}

const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdkRoot || !existsSync(resolve(sdkRoot, 'platforms'))) {
  throw new Error('Android SDK missing. Set ANDROID_HOME to an installed SDK with platforms and build-tools.');
}
run('java', ['-version']);
run('bun', ['run', '--cwd', resolve(mobileRoot, '../web'), 'build:herdr']);
run(process.execPath, [resolve(mobileRoot, 'scripts/prepare-herdr.mjs')]);
if (!existsSync(resolve(appRoot, 'android/gradlew'))) run(process.execPath, [cap, 'add', 'android']);
run(process.execPath, [cap, 'sync', 'android']);
run(resolve(appRoot, 'android/gradlew'), ['-p', 'android', 'assembleDebug']);
console.log(`OpenHerdr Android APK: ${resolve(appRoot, 'android/app/build/outputs/apk/debug/app-debug.apk')}`);
