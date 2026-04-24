/**
 * `mlflow-qwen-code setup` — interactively register the Stop hook in the
 * user's Qwen Code settings and write an MLflow tracing config alongside it.
 *
 * Writes:
 *   - `~/.qwen/settings.json` — registers the `mlflow-qwen-code stop-hook`
 *     entry under `hooks.Stop`; leaves unrelated fields untouched.
 *   - `~/.qwen/mlflow-tracing.json` — persists the tracking URI and
 *     experiment ID so the hook can run without shell exports.
 *
 * `--project` (or `-p`) writes to `./.qwen/` instead of `~/.qwen/`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const HOOK_COMMAND = 'mlflow-qwen-code stop-hook';
const DEFAULT_TRACKING_URI = 'http://localhost:5000';
const DEFAULT_EXPERIMENT_ID = '0';

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
  /** Pre-supplied tracking URI. Skips the interactive prompt. */
  trackingUri?: string;
  /** Pre-supplied experiment ID. Skips the interactive prompt. */
  experimentId?: string;
  /** Suppress prompts entirely. Uses defaults for any unset values. */
  nonInteractive?: boolean;
}

export function resolveSettingsPath(projectLocal: boolean, options: SetupOptions = {}): string {
  return projectLocal
    ? resolve(options.cwd ?? process.cwd(), '.qwen', 'settings.json')
    : resolve(options.home ?? homedir(), '.qwen', 'settings.json');
}

function resolveTracingConfigPath(projectLocal: boolean, options: SetupOptions = {}): string {
  return projectLocal
    ? resolve(options.cwd ?? process.cwd(), '.qwen', 'mlflow-tracing.json')
    : resolve(options.home ?? homedir(), '.qwen', 'mlflow-tracing.json');
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

function writeTracingConfig(
  path: string,
  config: { trackingUri: string; experimentId: string },
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

function hasMlflowHook(groups: QwenHookGroup[]): boolean {
  return groups.some((group) => group.hooks?.some((hook) => hook.command?.trim() === HOOK_COMMAND));
}

/**
 * Parse raw CLI args for the setup command. Supports:
 *   --project / -p
 *   --non-interactive / -y
 *   --tracking-uri <url>
 *   --experiment-id <id>
 */
export function parseSetupArgs(args: string[]): SetupOptions & { projectLocal: boolean } {
  const out: SetupOptions & { projectLocal: boolean } = { projectLocal: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--project' || arg === '-p') {
      out.projectLocal = true;
    } else if (arg === '--non-interactive' || arg === '-y') {
      out.nonInteractive = true;
    } else if (arg === '--tracking-uri') {
      out.trackingUri = args[++i];
    } else if (arg === '--experiment-id') {
      out.experimentId = args[++i];
    }
  }
  return out;
}

function prompt(label: string, defaultValue: string): Promise<string> {
  return new Promise((resolvePromise) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${label} [${defaultValue}]: `, (answer) => {
      rl.close();
      resolvePromise(answer.trim() || defaultValue);
    });
  });
}

async function resolveTracingValues(
  options: SetupOptions,
): Promise<{ trackingUri: string; experimentId: string }> {
  if (options.nonInteractive) {
    return {
      trackingUri: options.trackingUri ?? DEFAULT_TRACKING_URI,
      experimentId: options.experimentId ?? DEFAULT_EXPERIMENT_ID,
    };
  }
  if (options.trackingUri && options.experimentId) {
    return { trackingUri: options.trackingUri, experimentId: options.experimentId };
  }
  console.error('[mlflow] Configuring MLflow tracing for Qwen Code.');
  const trackingUri =
    options.trackingUri ?? (await prompt('MLflow tracking URI', DEFAULT_TRACKING_URI));
  const experimentId =
    options.experimentId ?? (await prompt('MLflow experiment ID', DEFAULT_EXPERIMENT_ID));
  return { trackingUri, experimentId };
}

export async function runSetup(args: string[], options: SetupOptions = {}): Promise<void> {
  const parsed = parseSetupArgs(args);
  const merged: SetupOptions & { projectLocal: boolean } = {
    ...parsed,
    ...options,
    projectLocal: parsed.projectLocal,
  };
  const settingsPath = resolveSettingsPath(merged.projectLocal, merged);
  const tracingConfigPath = resolveTracingConfigPath(merged.projectLocal, merged);

  const settings = readSettings(settingsPath);
  if (settings == null) {
    process.exitCode = 1;
    return;
  }
  settings.hooks ??= {};
  settings.hooks.Stop ??= [];

  if (hasMlflowHook(settings.hooks.Stop)) {
    console.error(`[mlflow] Stop hook already registered in ${settingsPath}`);
  } else {
    settings.hooks.Stop.push({
      hooks: [{ type: 'command', command: HOOK_COMMAND }],
    });
    writeSettings(settingsPath, settings);
    console.error(`[mlflow] Registered Stop hook in ${settingsPath}`);
  }

  const { trackingUri, experimentId } = await resolveTracingValues(merged);
  writeTracingConfig(tracingConfigPath, { trackingUri, experimentId });
  console.error(`[mlflow] Wrote tracing config to ${tracingConfigPath}`);

  console.error('\nNext steps:');
  console.error('  1. Start the MLflow tracking server in a separate terminal:');
  console.error(
    `       mlflow server --host 0.0.0.0 --port ${new URL(trackingUri).port || '5000'}`,
  );
  console.error(`  2. Launch \`qwen\` — traces appear at ${trackingUri} after each turn.`);
  console.error(
    '\nThe tracking URI and experiment ID can be overridden per-shell with',
    '$MLFLOW_TRACKING_URI / $MLFLOW_EXPERIMENT_ID.',
  );
}
