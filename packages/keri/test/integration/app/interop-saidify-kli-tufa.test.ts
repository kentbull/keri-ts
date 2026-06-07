// @file-test-lane interop-parity

import { assertEquals } from "jsr:@std/assert";
import { createInteropContext, requireSuccess, runCmd, runTufa, workspaceRoot } from "./interop-test-helpers.ts";

async function saidifyWithKli(
  kliCommand: string,
  env: Record<string, string>,
  path: string,
  label?: string,
): Promise<string> {
  await requireSuccess(
    `kli saidify ${label ?? "d"}`,
    runCmd(kliCommand, ["saidify", "--file", path, ...(label ? ["--label", label] : [])], env),
  );
  return await Deno.readTextFile(path);
}

async function saidifyWithTufa(
  env: Record<string, string>,
  path: string,
  label?: string,
): Promise<string> {
  await requireSuccess(
    `tufa saidify ${label ?? "d"}`,
    runTufa(["saidify", "--file", path, ...(label ? ["--label", label] : [])], env, workspaceRoot()),
  );
  return await Deno.readTextFile(path);
}

async function assertSaidifyParity(
  ctx: Awaited<ReturnType<typeof createInteropContext>>,
  name: string,
  sad: Record<string, unknown>,
  label?: string,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: `saidify-${name}-` });
  try {
    const raw = JSON.stringify(sad);
    const kliPath = `${dir}/kli.json`;
    const tufaPath = `${dir}/tufa.json`;
    await Promise.all([
      Deno.writeTextFile(kliPath, raw),
      Deno.writeTextFile(tufaPath, raw),
    ]);

    const [kli, tufa] = await Promise.all([
      saidifyWithKli(ctx.kliCommand, ctx.env, kliPath, label),
      saidifyWithTufa(ctx.env, tufaPath, label),
    ]);
    assertEquals(tufa, kli);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => undefined);
  }
}

Deno.test("Interop: tufa saidify matches KLI for default and schema labels", async () => {
  const ctx = await createInteropContext();
  await assertSaidifyParity(ctx, "default", {
    d: "",
    name: "alice",
    items: [1, true, null],
  });
  await assertSaidifyParity(ctx, "schema", {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "",
    type: "object",
    properties: {
      name: { type: "string" },
    },
  }, "$id");
});
