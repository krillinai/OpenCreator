import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('desktop project boundary', () => {
  it('keeps project creation in the Runtime instead of the native bridge', () => {
    const nativeActions = readFileSync('src/main/native-actions.ts', 'utf8');
    const main = readFileSync('src/main/main.ts', 'utf8');
    const ipc = readFileSync('src/shared/ipc.ts', 'utf8');
    const preload = readFileSync('src/preload/index.ts', 'utf8');

    expect(nativeActions).not.toContain('ensureDefaultProjectDirectory');
    expect(nativeActions).not.toContain('createNamedProjectDirectory');
    expect(main).not.toContain('desktopIpc.ensureDefaultProjectDirectory');
    expect(main).not.toContain('desktopIpc.createProjectDirectory');
    expect(ipc).not.toContain('ensureDefaultProjectDirectory');
    expect(ipc).not.toContain('createProjectDirectory');
    expect(preload).not.toContain('ensureDefaultProjectDirectory');
    expect(preload).not.toContain('createProjectDirectory');
  });

  it('passes the system documents directory to the Runtime managed project root', () => {
    const main = readFileSync('src/main/main.ts', 'utf8');
    const bootstrap = readFileSync('src/main/bootstrap-controller.ts', 'utf8');
    const daemonManager = readFileSync('src/main/daemon-manager.ts', 'utf8');

    expect(main).toContain("app.getPath('documents')");
    expect(bootstrap).toContain('defaultProjectRoot: this.input.defaultProjectRoot');
    expect(daemonManager).toContain(
      'OPENCREATOR_DEFAULT_PROJECT_ROOT: input.defaultProjectRoot'
    );
  });
});
