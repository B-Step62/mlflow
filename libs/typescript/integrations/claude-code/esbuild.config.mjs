import { build } from 'esbuild';
import { chmodSync } from 'node:fs';

const banner = {
  // Create a require function for CJS dependencies that use bare node specifiers
  js: [
    '#!/usr/bin/env node',
    'import { createRequire as __createRequire } from "node:module";',
    'const require = __createRequire(import.meta.url);',
  ].join('\n'),
};

for (const [entryPoint, outfile] of [
  ['dist/hooks/stop.js', 'bundle/stop.js'],
  ['dist/cli.js', 'bundle/cli.js'],
]) {
  await build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    external: ['node:*'],
    banner,
  });

  chmodSync(outfile, 0o755);
}
