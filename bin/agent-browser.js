#!/usr/bin/env node
import { main } from '../dist/cli.js';

main(process.argv.slice(2)).catch((e) => {
  process.stderr.write(`error: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}\n`);
  process.exit(1);
});
