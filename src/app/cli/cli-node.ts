import { run } from "npm:effection@^3.6.0";
import { argv, exit } from "node:process";
import { kli } from "./cli.ts";

run(() => kli(argv.slice(2))).catch((error) => {
  console.error("Fatal error:", error);
  exit(1);
});
