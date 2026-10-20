/** Measurement-only preloader for this dated CLI experiment; normal application launchers never import it. */
import { writeFileSync } from "node:fs";
import { getHeapStatistics } from "node:v8";
const started = performance.now();
// Exit code and synchronous snapshots cover the child CLI after its own completion/cleanup.
process.once("exit", (code) => {
  const memory = process.memoryUsage();
  writeFileSync(
    process.env.RUNTIME_MEMORY_RESULT,
    JSON.stringify({
      case: process.env.RUNTIME_MEMORY_CASE,
      round: Number(process.env.RUNTIME_MEMORY_ROUND),
      variant: process.env.RUNTIME_MEMORY_VARIANT,
      node: process.version,
      v8: process.versions.v8,
      arch: process.arch,
      pointerCompression: process.config.variables.v8_enable_pointer_compression,
      heapLimit: getHeapStatistics().heap_size_limit,
      exitCode: code,
      elapsedMs: performance.now() - started,
      maxRssKiB: process.resourceUsage().maxRSS,
      heapUsedAtExit: memory.heapUsed,
      externalAtExit: memory.external,
      arrayBuffersAtExit: memory.arrayBuffers,
    }) + "\n",
  );
});
