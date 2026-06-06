import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { tephraCli } from "../../src/cli/main.ts";
import type { CliIo } from "../../src/cli/types.ts";
import { counterV1 } from "../fixtures/counter-token-fixtures.ts";
import { v1ify } from "../fixtures/versioned-body-fixtures.ts";

const TEXT_ENCODER = new TextEncoder();
const VALID_FRAME = "{\"v\":\"KERI10JSON00002e_\",\"t\":\"rpy\",\"d\":\"Eabc\"}";

interface MemoryCliIo {
  io: CliIo;
  files: Map<string, Uint8Array>;
  stdout: string[];
  stderr: string[];
}

function memoryCliIo(
  options: { stdin?: string | Uint8Array; files?: Map<string, Uint8Array> } = {},
): MemoryCliIo {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const files = options.files ?? new Map<string, Uint8Array>();
  const stdin = typeof options.stdin === "string"
    ? TEXT_ENCODER.encode(options.stdin)
    : options.stdin ?? new Uint8Array(0);

  return {
    files,
    stdout,
    stderr,
    io: {
      readFile: (path: string) => {
        const file = files.get(path);
        if (!file) throw new Error(`missing file: ${path}`);
        return Promise.resolve(file);
      },
      writeTextFile: (path: string, text: string) => {
        files.set(path, TEXT_ENCODER.encode(text));
        return Promise.resolve();
      },
      readStdin: () => Promise.resolve(stdin),
      writeStdout: (text: string) => {
        stdout.push(text);
        return Promise.resolve();
      },
      writeStderr: (text: string) => {
        stderr.push(text);
        return Promise.resolve();
      },
    },
  };
}

Deno.test("tephra dispatcher handles top-level help and missing commands", async () => {
  const help = memoryCliIo();
  assertEquals(await tephraCli(["--help"], help.io), 0);
  assertStringIncludes(help.stdout.join(""), "Usage: tephra <command>");
  assertStringIncludes(help.stdout.join(""), "validate");

  const missing = memoryCliIo();
  assertEquals(await tephraCli([], missing.io), 1);
  assertStringIncludes(missing.stderr.join(""), "Usage: tephra <command>");
});

Deno.test("tephra dispatcher rejects unknown commands", async () => {
  const state = memoryCliIo();
  assertEquals(await tephraCli(["unknown"], state.io), 1);
  assertStringIncludes(state.stderr.join(""), "Unknown tephra command: unknown");
});

Deno.test("tephra dispatcher exposes command-specific help", async () => {
  for (const command of ["annotate", "validate", "bench"]) {
    const state = memoryCliIo();
    assertEquals(await tephraCli([command, "--help"], state.io), 0);
    assertStringIncludes(state.stdout.join(""), `Usage: tephra ${command}`);
  }
});

Deno.test("tephra annotate routes through the package-level dispatcher", async () => {
  const state = memoryCliIo({ stdin: VALID_FRAME });
  assertEquals(await tephraCli(["annotate"], state.io), 0);
  assertStringIncludes(state.stdout.join(""), "SERDER KERI JSON");
  assertEquals(state.stderr.join(""), "");
});

Deno.test("tephra validate accepts a valid CESR stream", async () => {
  const state = memoryCliIo({ stdin: VALID_FRAME });
  assertEquals(await tephraCli(["validate"], state.io), 0);
  const out = state.stdout.join("");
  assertStringIncludes(out, "CESR validation passed");
  assertStringIncludes(out, "frames: 1");
  assertStringIncludes(out, "attachment groups: 0");
});

Deno.test("tephra validate supports --framed parser mode", async () => {
  const state = memoryCliIo({ stdin: VALID_FRAME });
  assertEquals(await tephraCli(["validate", "--framed"], state.io), 0);
  assertStringIncludes(state.stdout.join(""), "CESR validation passed");
});

Deno.test("tephra validate reports malformed input errors", async () => {
  const state = memoryCliIo({ stdin: "?AAA" });
  assertEquals(await tephraCli(["validate"], state.io), 1);
  const err = state.stderr.join("");
  assertStringIncludes(err, "CESR validation failed");
  assertStringIncludes(err, "errors: 1");
});

Deno.test("tephra validate reports truncated input shortage", async () => {
  const state = memoryCliIo({ stdin: VALID_FRAME.slice(0, 12) });
  assertEquals(await tephraCli(["validate"], state.io), 1);
  assertStringIncludes(state.stderr.join(""), "ShortageError");
});

Deno.test("tephra validate rejects empty input with NoFramesError", async () => {
  const state = memoryCliIo();
  assertEquals(await tephraCli(["validate"], state.io), 1);
  const err = state.stderr.join("");
  assertStringIncludes(err, "NoFramesError");
  assertStringIncludes(err, "No CESR frames parsed");
});

Deno.test("tephra validate --json emits structured failure reports on stdout", async () => {
  const state = memoryCliIo();
  assertEquals(await tephraCli(["validate", "--json"], state.io), 1);
  assertEquals(state.stderr.join(""), "");
  const report = JSON.parse(state.stdout.join(""));
  assertEquals(report.ok, false);
  assertEquals(report.source, "stdin");
  assertEquals(report.errorCount, 1);
  assertEquals(report.errors[0].name, "NoFramesError");
});

Deno.test("tephra validate defaults strict and allows --compat", async () => {
  const body = v1ify("{\"v\":\"KERI10JSON000000_\",\"t\":\"rpy\",\"d\":\"Eabc\"}");
  const nestedV2List = "-JAB--FA";
  const mixedMajorStream = `${body}${counterV1("-V", nestedV2List.length / 4)}${nestedV2List}`;

  const strict = memoryCliIo({ stdin: mixedMajorStream });
  assertEquals(await tephraCli(["validate"], strict.io), 1);
  assertStringIncludes(strict.stderr.join(""), "CESR validation failed");

  const compat = memoryCliIo({ stdin: mixedMajorStream });
  assertEquals(await tephraCli(["validate", "--compat"], compat.io), 0);
  assertStringIncludes(compat.stdout.join(""), "CESR validation passed");
});

Deno.test("tephra bench routes through the package-level dispatcher", async () => {
  const state = memoryCliIo({ stdin: VALID_FRAME });
  assertEquals(await tephraCli(["bench", "--iterations", "1", "--warmup", "0"], state.io), 0);
  assertStringIncludes(state.stdout.join(""), "CESR parser benchmark");
  assertEquals(state.stderr.join(""), "");
});
