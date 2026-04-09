import { run } from "effection";
import { argv, exit } from "node:process";
import { reportCliFailure, tufa } from "../cli/cli.ts";

run(() => tufa(argv.slice(2))).catch((error) => {
  exit(reportCliFailure(error));
});
