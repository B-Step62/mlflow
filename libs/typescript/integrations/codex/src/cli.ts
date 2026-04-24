/**
 * CLI dispatcher for `@mlflow/codex`.
 *
 * Installed as the `mlflow-codex` bin. Dispatches on the first CLI arg:
 *   - `setup`       → registers the notify hook in ~/.codex/config.toml
 *   - `--help`/`-h` → prints usage
 *   - otherwise     → treats the argument as a Codex notify payload and runs
 *                     the hook. This is the form Codex itself uses, which
 *                     appends the JSON payload as the final argv entry.
 */

import { runNotifyHook } from './hooks/stop.js';
import { runSetup } from './commands/setup.js';

function printUsage(): void {
  console.error('Usage: mlflow-codex [command | <notify-payload>]');
  console.error('');
  console.error('Commands:');
  console.error('  setup       Register the notify hook in ~/.codex/config.toml');
  console.error('');
  console.error('When invoked with a JSON argument, treats it as a Codex notify');
  console.error('payload. This is the form Codex itself uses via config.toml.');
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    printUsage();
    return;
  }

  if (command === 'setup') {
    runSetup(rest);
    return;
  }

  await runNotifyHook(command);
}

void main();
