/**
 * npm executable entrypoint for the package-level `tephra` CLI.
 *
 * The CESR npm build discovers this file by the marker text in this comment and
 * prepends a Node shebang after DNT emits JavaScript. Keep this launcher thin so
 * Deno-only APIs do not leak into the Node executable path.
 */
import { argv, exit } from "node:process";
import { createNodeCliIo } from "./io-node.ts";
import { tephraCli } from "./main.ts";

const code = await tephraCli(argv.slice(2), createNodeCliIo());
exit(code);
