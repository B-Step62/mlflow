/**
 * CLI dispatcher for `@mlflow/qwen-code`.
 *
 * Installed as the `mlflow-qwen-code` bin. Subcommands:
 *   - `setup`       → registers the hook and writes mlflow-tracing.json
 *   - `stop-hook`   → runs the Stop hook (reads stdin JSON from Qwen Code)
 *   - `--help`/`-h` → prints usage
 *
 * Qwen Code invokes `mlflow-qwen-code stop-hook` as the registered Stop hook.
 */

import { runStopHook } from './hooks/stop.js';
import { runSetup } from './commands/setup.js';

function printUsage(): void {
  console.error('Usage: mlflow-qwen-code <command> [options]');
  console.error('');
  console.error('Commands:');
  console.error('  setup       Register the Stop hook in Qwen settings.json and configure');
  console.error('              the MLflow tracking URI / experiment ID. Runs interactively');
  console.error('              by default.');
  console.error('');
  console.error('              Flags:');
  console.error('                --project, -p          Write to ./.qwen/ instead of ~/.qwen/');
  console.error('                --non-interactive, -y  Skip prompts; use flag values or defaults');
  console.error('                --tracking-uri <url>   Bypass the prompt for the tracking URI');
  console.error('                --experiment-id <id>   Bypass the prompt for the experiment ID');
  console.error('');
  console.error('  stop-hook   Run the Qwen Code Stop hook. Reads the hook payload from stdin');
  console.error('              — this is the form Qwen itself invokes via settings.json.');
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

  if (command === 'stop-hook') {
    await runStopHook();
    return;
  }

  console.error(`[mlflow] Unknown command: ${command}`);
  printUsage();
  process.exitCode = 1;
}

void main();
