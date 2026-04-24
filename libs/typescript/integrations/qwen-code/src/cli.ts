/**
 * CLI dispatcher for `@mlflow/qwen-code`.
 *
 * Installed as the `mlflow-qwen-code` bin. Dispatches on the first CLI arg:
 *   - no args       → runs the Stop hook (reads stdin JSON from Qwen Code)
 *   - `setup`       → registers the hook in ~/.qwen/settings.json
 *   - `--help`/`-h` → prints usage
 */

import { runStopHook } from './hooks/stop.js';
import { runSetup } from './commands/setup.js';

function printUsage(): void {
  console.error('Usage: mlflow-qwen-code [command]');
  console.error('');
  console.error('Commands:');
  console.error('  setup [--project]   Register the Stop hook in Qwen settings.json');
  console.error(
    '                      (user-level by default; --project writes to ./.qwen/settings.json)',
  );
  console.error('');
  console.error('When invoked with no command, reads a Stop hook payload from stdin.');
  console.error('This is the form Qwen Code itself uses via settings.json.');
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  if (command === '--help' || command === '-h' || command === 'help') {
    printUsage();
    return;
  }

  if (command === 'setup') {
    runSetup(rest);
    return;
  }

  if (command !== undefined) {
    console.error(`[mlflow] Unknown command: ${command}`);
    printUsage();
    process.exitCode = 1;
    return;
  }

  await runStopHook();
}

void main();
