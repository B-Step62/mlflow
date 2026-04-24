import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runSetup } from '../src/commands/setup';

describe('runSetup', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'qwen-setup-test-'));
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  function read(path: string): Record<string, unknown> {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  }

  it('creates ~/.qwen/settings.json when it does not exist', () => {
    runSetup([], { home: tmpHome });

    const settingsPath = join(tmpHome, '.qwen', 'settings.json');
    expect(existsSync(settingsPath)).toBe(true);
    expect(read(settingsPath)).toEqual({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'mlflow-qwen-code' }] }],
      },
    });
  });

  it('preserves unrelated fields when merging into an existing file', () => {
    const settingsPath = join(tmpHome, '.qwen', 'settings.json');
    mkdirSync(join(tmpHome, '.qwen'), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({ theme: 'dark', security: { auth: { selectedType: 'openai' } } }),
      'utf-8',
    );

    runSetup([], { home: tmpHome });

    const settings = read(settingsPath);
    expect(settings.theme).toBe('dark');
    expect(settings.security).toEqual({ auth: { selectedType: 'openai' } });
    expect((settings.hooks as { Stop: unknown }).Stop).toEqual([
      { hooks: [{ type: 'command', command: 'mlflow-qwen-code' }] },
    ]);
  });

  it('is idempotent when the hook is already registered', () => {
    runSetup([], { home: tmpHome });
    const settingsPath = join(tmpHome, '.qwen', 'settings.json');
    const first = readFileSync(settingsPath, 'utf-8');

    runSetup([], { home: tmpHome });
    const second = readFileSync(settingsPath, 'utf-8');

    expect(second).toBe(first);
  });

  it('appends alongside other Stop hooks without overwriting them', () => {
    const settingsPath = join(tmpHome, '.qwen', 'settings.json');
    mkdirSync(join(tmpHome, '.qwen'), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'some-other-hook' }] }] },
      }),
      'utf-8',
    );

    runSetup([], { home: tmpHome });

    const settings = read(settingsPath) as { hooks: { Stop: unknown[] } };
    expect(settings.hooks.Stop).toHaveLength(2);
    expect(settings.hooks.Stop).toEqual([
      { hooks: [{ type: 'command', command: 'some-other-hook' }] },
      { hooks: [{ type: 'command', command: 'mlflow-qwen-code' }] },
    ]);
  });

  it('writes to ./.qwen/settings.json when --project is passed', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'qwen-project-test-'));
    try {
      runSetup(['--project'], { home: tmpHome, cwd });
      const projectPath = join(cwd, '.qwen', 'settings.json');
      expect(existsSync(projectPath)).toBe(true);
      expect(read(projectPath)).toEqual({
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: 'mlflow-qwen-code' }] }],
        },
      });
      expect(existsSync(join(tmpHome, '.qwen', 'settings.json'))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('reports a friendly error and exits 1 when settings.json is malformed', () => {
    const settingsPath = join(tmpHome, '.qwen', 'settings.json');
    mkdirSync(join(tmpHome, '.qwen'), { recursive: true });
    writeFileSync(settingsPath, '{ not valid json', 'utf-8');
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      runSetup([], { home: tmpHome });
      expect(process.exitCode).toBe(1);
      // The malformed file must be left untouched so the user can fix it by hand.
      expect(readFileSync(settingsPath, 'utf-8')).toBe('{ not valid json');
    } finally {
      process.exitCode = originalExitCode;
    }
  });
});
