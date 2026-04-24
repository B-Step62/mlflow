/**
 * `mlflow-codex setup` — interactively register the notify hook in the user's
 * Codex config and write an MLflow tracing config alongside it.
 *
 * Writes:
 *   - `~/.codex/config.toml` — prepends `notify = ["mlflow-codex", "notify-hook"]`
 *     ahead of any `[section]` headers. Refuses to modify a pre-existing
 *     `notify = ...` entry to avoid mangling the user's config.
 *   - `~/.codex/mlflow-tracing.json` — persists the tracking URI and
 *     experiment ID so the hook can run without shell exports.
 *
 * `--project` (or `-p`) writes to `./.codex/` instead of `~/.codex/`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const HOOK_LINE = 'notify = ["mlflow-codex", "notify-hook"]';
const NOTIFY_LINE_RE = /^\s*notify\s*=.*$/m;
const NOTIFY_HAS_MLFLOW_RE = /^\s*notify\s*=.*["']mlflow-codex["']/m;
const DEFAULT_TRACKING_URI = 'http://localhost:5000';
const DEFAULT_EXPERIMENT_ID = '0';

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

export function resolveConfigPath(projectLocal: boolean, options: SetupOptions = {}): string {
  return projectLocal
    ? resolve(options.cwd ?? process.cwd(), '.codex', 'config.toml')
    : resolve(options.home ?? homedir(), '.codex', 'config.toml');
}

function resolveTracingConfigPath(projectLocal: boolean, options: SetupOptions = {}): string {
  return projectLocal
    ? resolve(options.cwd ?? process.cwd(), '.codex', 'mlflow-tracing.json')
    : resolve(options.home ?? homedir(), '.codex', 'mlflow-tracing.json');
}

function writeConfigWithHook(path: string, original: string | null): void {
  mkdirSync(dirname(path), { recursive: true });
  const prefix = `# Added by \`mlflow-codex setup\` — forwards each Codex turn to MLflow Tracing.\n${HOOK_LINE}\n`;
  const content = original ? prefix + '\n' + original : prefix;
  writeFileSync(path, content, 'utf-8');
}

function writeTracingConfig(
  path: string,
  config: { trackingUri: string; experimentId: string },
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf-8');
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
  console.error('[mlflow] Configuring MLflow tracing for Codex CLI.');
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
  const configPath = resolveConfigPath(merged.projectLocal, merged);
  const tracingConfigPath = resolveTracingConfigPath(merged.projectLocal, merged);

  let hookRegistered = false;
  if (!existsSync(configPath)) {
    writeConfigWithHook(configPath, null);
    console.error(`[mlflow] Created ${configPath} with notify hook`);
    hookRegistered = true;
  } else {
    const content = readFileSync(configPath, 'utf-8');
    if (NOTIFY_LINE_RE.test(content)) {
      if (NOTIFY_HAS_MLFLOW_RE.test(content)) {
        console.error(`[mlflow] Notify hook already registered in ${configPath}`);
        hookRegistered = true;
      } else {
        console.error(`[mlflow] ${configPath} already has a \`notify = ...\` entry.`);
        console.error(`[mlflow] Update it manually to: ${HOOK_LINE}`);
        process.exitCode = 1;
        return;
      }
    } else {
      writeConfigWithHook(configPath, content);
      console.error(`[mlflow] Added notify hook to ${configPath}`);
      hookRegistered = true;
    }
  }

  if (!hookRegistered) {
    return;
  }

  const { trackingUri, experimentId } = await resolveTracingValues(merged);
  writeTracingConfig(tracingConfigPath, { trackingUri, experimentId });
  console.error(`[mlflow] Wrote tracing config to ${tracingConfigPath}`);

  console.error('\nNext steps:');
  console.error('  1. Start the MLflow tracking server in a separate terminal:');
  console.error(
    `       mlflow server --host 0.0.0.0 --port ${new URL(trackingUri).port || '5000'}`,
  );
  console.error(`  2. Launch \`codex\` — traces appear at ${trackingUri} after each turn.`);
  console.error(
    '\nThe tracking URI and experiment ID can be overridden per-shell with',
    '$MLFLOW_TRACKING_URI / $MLFLOW_EXPERIMENT_ID.',
  );
}
