/**
 * Poll the `tufa agent` health endpoint during Docker npm smoke tests.
 *
 * The shell wrapper starts the agent in the background and passes its PID plus
 * log/exit-code file paths here. Keeping the polling and diagnostics in Node
 * source avoids embedding a multiline JS program inside the smoke shell script.
 */
import { readFile } from "node:fs/promises";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const port = process.env.TUFA_SMOKE_PORT ?? "";
const url = `http://127.0.0.1:${port}/health`;
const agentPid = Number(process.env.TUFA_SMOKE_AGENT_PID ?? "0");
const agentExitFile = process.env.TUFA_SMOKE_AGENT_EXIT_FILE ?? "";
const agentLog = process.env.TUFA_SMOKE_AGENT_LOG ?? "/tmp/tufa-agent.log";
let lastStatus = "";

/** Read the background agent's recorded exit code when it has already exited. */
async function readExitCode() {
  if (!agentExitFile) return null;
  try {
    return (await readFile(agentExitFile, "utf8")).trim() || "<empty>";
  } catch {
    return null;
  }
}

/** Check whether the background agent process is still alive. */
function agentAlive() {
  if (!Number.isFinite(agentPid) || agentPid <= 0) {
    return true;
  }
  try {
    process.kill(agentPid, 0);
    return true;
  } catch {
    return false;
  }
}

for (let attempt = 0; attempt < 200; attempt += 1) {
  try {
    const response = await fetch(url);
    const text = await response.text();
    lastStatus = `${response.status} ${text}`;
    if (response.ok && text === "ok") {
      process.exit(0);
    }
  } catch (error) {
    lastStatus = String(error);
  }
  if (!agentAlive()) {
    const exitCode = await readExitCode();
    lastStatus += exitCode ? ` (agent exited with code ${exitCode})` : " (agent exited)";
    break;
  }
  await delay(100);
}

process.stderr.write(`Health probe failed: ${lastStatus}\n`);
process.stderr.write(`Agent PID: ${Number.isFinite(agentPid) ? String(agentPid) : "<unknown>"}\n`);
process.stderr.write(`Agent alive: ${agentAlive() ? "yes" : "no"}\n`);
const exitCode = await readExitCode();
process.stderr.write(`Agent exit code: ${exitCode ?? "<unknown>"}\n`);
try {
  const log = await readFile(agentLog, "utf8");
  process.stderr.write(`--- ${agentLog} ---\n`);
  process.stderr.write(log.length > 0 ? log : "<empty>\n");
  if (!log.endsWith("\n")) {
    process.stderr.write("\n");
  }
  process.stderr.write(`--- end ${agentLog} ---\n`);
} catch (error) {
  process.stderr.write(`Unable to read ${agentLog}: ${String(error)}\n`);
}
process.exit(1);
