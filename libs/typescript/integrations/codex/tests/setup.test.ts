import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runSetup } from '../src/commands/setup';

describe('runSetup', () => {
  let tmpHome: string;
  let originalExitCode: number | string | undefined;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'codex-setup-test-'));
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
    process.exitCode = originalExitCode;
  });

  function readConfig(path: string): string {
    return readFileSync(path, 'utf-8');
  }

  it('creates ~/.codex/config.toml with the notify hook when absent', () => {
    runSetup([], { home: tmpHome });

    const configPath = join(tmpHome, '.codex', 'config.toml');
    expect(existsSync(configPath)).toBe(true);
    const content = readConfig(configPath);
    expect(content).toContain('notify = ["mlflow-codex"]');
  });

  it('prepends the notify hook to an existing config that has no notify entry', () => {
    const configPath = join(tmpHome, '.codex', 'config.toml');
    mkdirSync(join(tmpHome, '.codex'), { recursive: true });
    const existing = '[some.section]\nkey = "value"\n';
    writeFileSync(configPath, existing, 'utf-8');

    runSetup([], { home: tmpHome });

    const content = readConfig(configPath);
    expect(content).toContain('notify = ["mlflow-codex"]');
    expect(content).toContain('[some.section]');
    expect(content).toContain('key = "value"');
    // notify line must come before the section header so TOML parses correctly
    expect(content.indexOf('notify = ')).toBeLessThan(content.indexOf('[some.section]'));
  });

  it('is idempotent when the hook is already registered', () => {
    runSetup([], { home: tmpHome });
    const configPath = join(tmpHome, '.codex', 'config.toml');
    const first = readConfig(configPath);

    runSetup([], { home: tmpHome });
    const second = readConfig(configPath);

    expect(second).toBe(first);
    expect(process.exitCode).toBeFalsy();
  });

  it('refuses to overwrite a different notify entry and signals exit 1', () => {
    const configPath = join(tmpHome, '.codex', 'config.toml');
    mkdirSync(join(tmpHome, '.codex'), { recursive: true });
    writeFileSync(configPath, 'notify = ["some-other-tool"]\n', 'utf-8');

    runSetup([], { home: tmpHome });

    const content = readConfig(configPath);
    expect(content).toBe('notify = ["some-other-tool"]\n');
    expect(process.exitCode).toBe(1);
  });

  it('does not treat a comment mentioning "mlflow-codex" as an existing registration', () => {
    const configPath = join(tmpHome, '.codex', 'config.toml');
    mkdirSync(join(tmpHome, '.codex'), { recursive: true });
    // The mlflow-codex string appears in a comment, not in the notify
    // assignment. The user's actual notify hook is some-other-tool, so the
    // setup command must error out rather than silently claim success.
    writeFileSync(
      configPath,
      '# TODO: switch to mlflow-codex\nnotify = ["some-other-tool"]\n',
      'utf-8',
    );

    runSetup([], { home: tmpHome });

    expect(process.exitCode).toBe(1);
    const content = readConfig(configPath);
    expect(content).toContain('notify = ["some-other-tool"]');
    expect(content).not.toContain('notify = ["mlflow-codex"]');
  });
});
