import { expect, test } from 'bun:test';
import { workspaceFilePath } from './workspace-navigation';

test('tool file paths stay inside the captured canonical workspace', () => {
  expect(workspaceFilePath('/project/src/a.ts', '/project')).toBe('src/a.ts');
  expect(workspaceFilePath('./src/a.ts', '/project/')).toBe('src/a.ts');
  expect(workspaceFilePath('src/a file.ts', '/project')).toBe('src/a file.ts');
  expect(workspaceFilePath('/etc/hosts', '/')).toBe('etc/hosts');
  for (const path of ['/project-other/a.ts', '/etc/hosts', '../a.ts', 'src/../../a.ts', '/project/../a.ts', 'file:///project/a.ts', 'https://example.com/a.ts', 'src\\a.ts', 'src/a\0.ts', '/project']) {
    expect(workspaceFilePath(path, '/project')).toBeNull();
  }
  expect(workspaceFilePath('a.ts', '')).toBeNull();
});
