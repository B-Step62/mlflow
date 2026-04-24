/**
 * `mlflow-qwen-code setup` — register the Stop hook in the user's Qwen Code
 * settings file so tracing is active on the next `qwen` invocation.
 *
 * Writes to `~/.qwen/settings.json` by default, or `./.qwen/settings.json`
 * when `--project` is passed. Creates the file if it doesn't exist; leaves
 * existing fields untouched.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

const HOOK_COMMAND = 'mlflow-qwen-code';

interface QwenHookEntry {
  type: string;
  command: string;
}

interface QwenHookGroup {
  hooks: QwenHookEntry[];
}

interface QwenSettings {
  hooks?: {
    Stop?: QwenHookGroup[];
    [key: string]: QwenHookGroup[] | undefined;
  };
  [key: string]: unknown;
}

export interface SetupOptions {
  /** Override the user home directory. Defaults to `os.homedir()`. */
  home?: string;
  /** Override the current working directory. Defaults to `process.cwd()`. */
  cwd?: string;
}

export function resolveSettingsPath(projectLocal: boolean, options: SetupOptions = {}): string {
  return projectLocal
    ? resolve(options.cwd ?? process.cwd(), '.qwen', 'settings.json')
    : resolve(options.home ?? homedir(), '.qwen', 'settings.json');
}

function readSettings(path: string): QwenSettings | null {
  if (!existsSync(path)) {
    return {};
  }
  const content = readFileSync(path, 'utf-8').trim();
  if (!content) {
    return {};
  }
  try {
    return JSON.parse(content) as QwenSettings;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[mlflow] Failed to parse ${path}: ${msg}`);
    console.error('[mlflow] Fix the file manually and rerun `mlflow-qwen-code setup`.');
    return null;
  }
}

function writeSettings(path: string, settings: QwenSettings): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

function hasMlflowHook(groups: QwenHookGroup[]): boolean {
  return groups.some((group) => group.hooks?.some((hook) => hook.command?.trim() === HOOK_COMMAND));
}

export function runSetup(args: string[], options: SetupOptions = {}): void {
  const projectLocal = args.includes('--project') || args.includes('-p');
  const settingsPath = resolveSettingsPath(projectLocal, options);

  const settings = readSettings(settingsPath);
  if (settings == null) {
    process.exitCode = 1;
    return;
  }
  settings.hooks ??= {};
  settings.hooks.Stop ??= [];

  if (hasMlflowHook(settings.hooks.Stop)) {
    console.error(`[mlflow] Hook already registered in ${settingsPath}`);
  } else {
    settings.hooks.Stop.push({
      hooks: [{ type: 'command', command: HOOK_COMMAND }],
    });
    writeSettings(settingsPath, settings);
    console.error(`[mlflow] Registered Stop hook in ${settingsPath}`);
  }

  console.error('\nNext steps:');
  console.error('  1. Export MLflow environment variables in the shell that launches `qwen`:');
  console.error('       export MLFLOW_TRACKING_URI=http://localhost:5000');
  console.error('       export MLFLOW_EXPERIMENT_ID=0');
  console.error('  2. Start the MLflow tracking server in a separate terminal:');
  console.error('       mlflow server --host 0.0.0.0 --port 5000');
  console.error('  3. Launch `qwen` — traces appear at http://localhost:5000 after each turn.');
}
