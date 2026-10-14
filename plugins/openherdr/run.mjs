#!/usr/bin/env node
import { runOpenHerdr } from '../../packages/web/bin/openherdr.js';
import { spawnSync } from 'node:child_process';

if (process.argv[2] === 'pair-pane') {
  const args = ['plugin', 'pane', 'open', '--plugin', 'openherdr', '--entrypoint', 'connect', '--placement', 'overlay'];
  if (process.env.HERDR_WORKSPACE_ID) args.push('--workspace', process.env.HERDR_WORKSPACE_ID);
  if (process.env.HERDR_PANE_ID) args.push('--target-pane', process.env.HERDR_PANE_ID);
  const result = spawnSync(process.env.HERDR_BIN_PATH || 'herdr', args, { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} else process.exitCode = await runOpenHerdr(process.argv.slice(2));
