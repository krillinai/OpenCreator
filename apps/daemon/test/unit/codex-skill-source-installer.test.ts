import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCodexSkillSourceInstaller,
  type SkillInstallerProcessRunner,
} from '../../src/codex/skills/source-installer.js';

let tempDir = '';

afterEach(() => {
  vi.restoreAllMocks();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('codex skill source installer', () => {
  it('calls the Codex Skill Installer with the catalog repository, path, ref, and skill id', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-skill-source-installer-'));
    const codexHome = join(tempDir, 'codex-home');
    const workDir = join(tempDir, 'work');
    const scriptPath = join(tempDir, 'install-skill-from-github.py');
    writeFileSync(scriptPath, '# test installer');
    const runProcess: SkillInstallerProcessRunner = vi.fn(async (_command, args) => {
      const dest = args[args.indexOf('--dest') + 1]!;
      const name = args[args.indexOf('--name') + 1]!;
      mkdirSync(join(dest, name), { recursive: true });
      writeFileSync(join(dest, name, 'SKILL.md'), '---\nname: test-skill\ndescription: test\n---\n');
    });
    const installer = createCodexSkillSourceInstaller({
      codexHome,
      scriptPath,
      pythonBin: 'python-test',
      sslCertFile: '/certifi/cacert.pem',
      runProcess,
    });

    const sourcePath = await installer.install({
      repository: 'owner/repo',
      skillPath: 'skills/test-skill',
      ref: 'develop',
      skillId: 'test-skill',
      workDir,
    });

    expect(runProcess).toHaveBeenCalledWith(
      'python-test',
      [
        scriptPath,
        '--repo',
        'owner/repo',
        '--path',
        'skills/test-skill',
        '--ref',
        'develop',
        '--name',
        'test-skill',
        '--dest',
        workDir,
        '--method',
        'download',
      ],
      expect.objectContaining({
        cwd: workDir,
        env: expect.objectContaining({
          CODEX_HOME: codexHome,
          SSL_CERT_FILE: '/certifi/cacert.pem',
        }),
      })
    );
    expect(sourcePath).toBe(join(workDir, 'test-skill'));
    expect(existsSync(join(sourcePath, 'SKILL.md'))).toBe(true);
  });

  it('preserves the real Codex Skill Installer error message', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-skill-source-installer-'));
    const scriptPath = join(tempDir, 'install-skill-from-github.py');
    writeFileSync(scriptPath, '# test installer');
    const runProcess: SkillInstallerProcessRunner = vi.fn(async () => {
      throw Object.assign(new Error('process exited with code 1'), {
        stderr: 'Error: SKILL.md not found in selected skill directory.\n',
      });
    });
    const installer = createCodexSkillSourceInstaller({
      codexHome: join(tempDir, 'codex-home'),
      scriptPath,
      runProcess,
    });

    await expect(
      installer.install({
        repository: 'owner/repo',
        skillPath: '.',
        ref: 'main',
        skillId: 'test-skill',
        workDir: join(tempDir, 'work'),
      })
    ).rejects.toThrow(
      'CODEX_SKILL_MARKET_INSTALL_FAILED: SKILL.md not found in selected skill directory.'
    );
  });

  it('reports a missing Codex Skill Installer script before spawning a process', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-skill-source-installer-'));
    const runProcess: SkillInstallerProcessRunner = vi.fn();
    const installer = createCodexSkillSourceInstaller({
      codexHome: join(tempDir, 'codex-home'),
      runProcess,
    });

    await expect(
      installer.install({
        repository: 'owner/repo',
        skillPath: '.',
        ref: 'main',
        skillId: 'test-skill',
        workDir: join(tempDir, 'work'),
      })
    ).rejects.toThrow(/CODEX_SKILL_MARKET_INSTALL_FAILED: Codex Skill Installer script not found/);
    expect(runProcess).not.toHaveBeenCalled();
  });
});
