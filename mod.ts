import { run } from 'effection';
import { kli } from './src/app/cli/cli.ts';

/**
 * Main entry point - Effection is the outermost runtime
 * All execution happens within Effection's structured concurrency
 */
run(
  () => kli(process.argv.slice(2))
)
.catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
