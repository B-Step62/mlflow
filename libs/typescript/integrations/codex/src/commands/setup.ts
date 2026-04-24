/**
 * `mlflow-codex setup` — register the notify hook in the user's Codex config
 * so tracing is active on the next `codex` invocation.
 *
 * Writes to `~/.codex/config.toml`. Creates the file if it doesn't exist; if
 * a `notify = ...` line already exists we do NOT rewrite it — TOML structure
 * is fragile and we'd rather preserve the user's config than mangle it.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

const HOOK_LINE = 'notify = ["mlflow-codex"]';
const NOTIFY_LINE_RE = /^\s*notify\s*=/m;

export interface SetupOptions {
  /** Override the user home directory. Defaults to `os.homedir()`. */
  home?: string;
}

export function resolveConfigPath(options: SetupOptions = {}): string {
  return resolve(options.home ?? homedir(), '.codex', 'config.toml');
}

function writeConfigWithHook(path: string, original: string | null): void {
  mkdirSync(dirname(path), { recursive: true });
  const prefix = `# Added by \`mlflow-codex setup\` — forwards each Codex turn to MLflow Tracing.\n${HOOK_LINE}\n`;
  const content = original ? prefix + '\n' + original : prefix;
  writeFileSync(path, content, 'utf-8');
}

export function runSetup(_args: string[], options: SetupOptions = {}): void {
  const configPath = resolveConfigPath(options);

  if (!existsSync(configPath)) {
    writeConfigWithHook(configPath, null);
    console.error(`[mlflow] Created ${configPath} with notify hook`);
  } else {
    const content = readFileSync(configPath, 'utf-8');
    if (NOTIFY_LINE_RE.test(content)) {
      if (content.includes('mlflow-codex')) {
        console.error(`[mlflow] Hook already registered in ${configPath}`);
      } else {
        console.error(`[mlflow] ${configPath} already has a \`notify = ...\` entry.`);
        console.error('[mlflow] Update it manually to: notify = ["mlflow-codex"]');
        process.exitCode = 1;
        return;
      }
    } else {
      writeConfigWithHook(configPath, content);
      console.error(`[mlflow] Added notify hook to ${configPath}`);
    }
  }

  console.error('\nNext steps:');
  console.error('  1. Export MLflow environment variables in the shell that launches `codex`:');
  console.error('       export MLFLOW_TRACKING_URI=http://localhost:5000');
  console.error('       export MLFLOW_EXPERIMENT_ID=0');
  console.error('  2. Start the MLflow tracking server in a separate terminal:');
  console.error('       mlflow server --host 0.0.0.0 --port 5000');
  console.error('  3. Launch `codex` — traces appear at http://localhost:5000 after each turn.');
}
