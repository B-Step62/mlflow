/**
 * CLI dispatcher for `@mlflow/codex`.
 *
 * Installed as the `mlflow-codex` bin. Subcommands:
 *   - `setup`       → registers the notify hook and writes mlflow-tracing.json
 *   - `notify-hook` → runs the Codex notify handler (Codex appends the JSON
 *                     payload as the final argv entry)
 *   - `--help`/`-h` → prints usage
 *
 * Codex invokes `mlflow-codex notify-hook` as the registered notify handler.
 * Codex appends the turn JSON as the final argument.
 */

import { runNotifyHook } from './hooks/stop.js';
import { runSetup } from './commands/setup.js';

function printUsage(): void {
  console.error('Usage: mlflow-codex <command> [options]');
  console.error('');
  console.error('Commands:');
  console.error('  setup        Register the notify hook in ~/.codex/config.toml and configure');
  console.error('               the MLflow tracking URI / experiment ID. Runs interactively');
  console.error('               by default.');
  console.error('');
  console.error('               Flags:');
  console.error('                 --project, -p          Write to ./.codex/ instead of ~/.codex/');
  console.error(
    '                 --non-interactive, -y  Skip prompts; use flag values or defaults',
  );
  console.error('                 --tracking-uri <url>   Bypass the prompt for the tracking URI');
  console.error('                 --experiment-id <id>   Bypass the prompt for the experiment ID');
  console.error('');
  console.error('  notify-hook  Run the Codex notify handler. Codex appends the turn JSON as');
  console.error('               the final argument — this is the form Codex itself uses via');
  console.error('               config.toml.');
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    printUsage();
    if (command === undefined) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === 'setup') {
    await runSetup(rest);
    return;
  }

  if (command === 'notify-hook') {
    const payload = rest[0];
    if (payload === undefined) {
      console.error('[mlflow] notify-hook expects a JSON payload as the first argument');
      process.exitCode = 1;
      return;
    }
    await runNotifyHook(payload);
    return;
  }

  console.error(`[mlflow] Unknown command: ${command}`);
  printUsage();
  process.exitCode = 1;
}

void main();
