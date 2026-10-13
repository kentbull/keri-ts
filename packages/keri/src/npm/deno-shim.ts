/**
 * npm-only Deno shim with the file durability methods missing from shim-deno 0.18.
 * Deno source uses its native filesystem; DNT selects this module only for Node.
 */
import { fsync, fsyncSync } from "node:fs";
import { Deno as ShimDeno } from "npm:@deno/shim-deno@0.18.2";

/** Flush file contents and metadata using the Node descriptor owned by the shim. */
ShimDeno.FsFile.prototype.sync = function sync(): Promise<void> {
  return new Promise((resolve, reject) => {
    fsync(this.rid, (error) => error ? reject(error) : resolve());
  });
};

/** Match Deno's synchronous durability boundary for existing config-file callers. */
ShimDeno.FsFile.prototype.syncSync = function syncSync(): void {
  fsyncSync(this.rid);
};

export { ShimDeno as Deno };
