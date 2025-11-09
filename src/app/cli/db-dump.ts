/**
 * Database dump command for CLI
 *
 * Dumps the contents of Baser.evts sub-database to console in prettified table format
 */

import { type Operation } from "effection";
import { displayStr } from "../../core/bytes.ts";
import { Baser, BaserOptions } from "../../db/basing.ts";

/**
 * Dump the evts sub-database to console
 */
export function* dumpEvts(args: Record<string, unknown>): Operation<void> {
  const name = args.name as string | undefined;
  const base = args.base as string | undefined;
  const temp = args.temp as boolean | undefined;
  const readonly = true; // Always open readonly for dump

  if (!name) {
    console.error("Error: --name is required");
    return;
  }

  console.log(`Dumping database ${name} from ${base} in temp mode: ${temp}`);

  const options: BaserOptions = {
    name,
    base,
    temp,
    reopen: true,
    readonly,
    dupsort: false,
  };

  const baser = new Baser(options);

  try {
    const opened = yield* baser.reopen(options);
    if (!opened) {
      console.error(`Failed to open database ${name} from ${base} in temp mode: ${temp}`);
      throw new Error(`Failed to open database ${name} from ${base} in temp mode: ${temp}`);
    }

    // get database version
    const version = baser.getVer();
    console.log(`Database version: ${version}`);

    // Get count
    const count = baser.cntEvts();
    console.log(`\nBaser.evts sub-database dump (${count} entries)\n`);
    console.log("=".repeat(137));

    // Print header
    console.log(`${"Key".padEnd(89)} | ${"Value (UTF-8)".padEnd(45)}`);
    console.log("-".repeat(137));

    // Iterate and print entries (empty top = all items)
    const iter = baser.getAllEvtsIter(new Uint8Array(0));
    let entryCount = 0;
    let keyColSize = 50;
    let valColSize = 50;

    for (const [keyBytes, valBytes] of iter) {
      entryCount++;
      const keyStr = displayStr(keyBytes);
      if (keyStr.length > keyColSize) {
        keyColSize = keyStr.length;
      }
      const valStr = displayStr(valBytes, 45);
      if (valStr.length > valColSize) {
        valColSize = valStr.length;
      }
      console.log(`${keyStr.padEnd(50)} | ${valStr.padEnd(45)}`);
    }

    console.log("=".repeat(137));
    console.log(`\nTotal entries: ${entryCount}`);
  } catch (error) {
    console.error(`Error dumping database: ${error}`);
    throw error;
  } finally {
    yield* baser.close();
  }
}
