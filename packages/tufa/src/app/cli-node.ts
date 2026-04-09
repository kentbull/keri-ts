import { argv, exit } from "node:process";
import { run } from "npm:effection@^3.6.0";
import { reportCliFailure, tufa } from "../../../keri/src/app/cli/cli.ts";

run(() => tufa(argv.slice(2))).catch((error) => {
  exit(reportCliFailure(error));
});
