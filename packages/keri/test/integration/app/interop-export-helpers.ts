/** Exact wire and evidence checks for CLI exports with independently selected genera. */
import { assert, assertEquals, assertInstanceOf } from "jsr:@std/assert";
import { fromFileUrl } from "jsr:@std/path/from-file-url";
import {
  type CesrFrame,
  Counter,
  Dater,
  isGroupTuple,
  NumberPrimitive,
  parse,
  Siger,
} from "../../../../cesr/mod.ts";
import { extractKelStream, normalizeCesr } from "./interop-test-helpers.ts";

/** Read-only reference cloning both wire encodings from the same KERIpy store. */
const EXPORT = fromFileUrl(new URL("../../../../../scripts/ci/keripy-export-genera.py", import.meta.url));

/** Parse this finite fixture with an explicit external genus, not body-based guessing. */
async function exportFrame(wire: string, major: 1 | 2): Promise<CesrFrame> {
  /** Supply the known stream genus before the unmodified finite CLI output. */
  async function* source() {
    // CLI export has no selector; this supplies the independently known source context.
    yield Counter.makeGVC({ major, minor: 0 });
    yield new TextEncoder().encode(wire);
  }
  const frames: CesrFrame[] = [];
  for await (const frame of parse(source())) frames.push(frame);
  assertEquals(frames.length, 1);
  assertEquals(frames[0].body.pvrsn, { major: 1, minor: 0 });
  return frames[0];
}

/** Check every attachment and its order in this single-signature inception fixture. */
function evidence(frame: CesrFrame, major: 1 | 2): unknown {
  assertEquals(frame.attachments.map((group) => group.name), ["ControllerIdxSigs", "FirstSeenReplayCouples"]);
  assertEquals(frame.attachments.map((group) => group.code), major === 1 ? ["-A", "-E"] : ["-K", "-O"]);
  const [signatures, firstSeen] = frame.attachments;
  assertEquals(signatures.items.length, 1);
  const signatureTuple = signatures.items[0];
  assert(isGroupTuple(signatureTuple));
  assertEquals(signatureTuple.length, 1);
  const [signature] = signatureTuple;
  assertInstanceOf(signature, Siger);
  assertEquals(signature.index, 0);
  assertEquals(firstSeen.items.length, 1);
  const couple = firstSeen.items[0];
  assert(isGroupTuple(couple));
  const [ordinal, date] = couple;
  assertEquals(couple.length, 2);
  assertInstanceOf(ordinal, NumberPrimitive);
  assertEquals(ordinal.code, major === 1 ? "0A" : "M");
  assertInstanceOf(date, Dater);
  assertEquals(ordinal.num, 0n);
  return [frame.body.raw, signature.qb64, normalizeCesr(date.qb64)];
}

/** Retain exact byte parity for each genus and compare the actual CLI streams' full evidence. */
export async function assertExportParity(
  ctx: { pythonCommand: string; env: Record<string, string> },
  store: { name: string; base: string; passcode: string; alias: string },
  tufaOutput: string,
  kliOutput: string,
): Promise<void> {
  const result = await new Deno.Command(ctx.pythonCommand, {
    args: [EXPORT, "--name", store.name, "--base", store.base, "--passcode", store.passcode, "--alias", store.alias],
    env: ctx.env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
  const reference = JSON.parse(new TextDecoder().decode(result.stdout)) as Record<"1" | "2", string>;
  const tufa = extractKelStream(tufaOutput);
  const kli = extractKelStream(kliOutput);
  // Timestamp normalization is the sole wire concession; counters/signatures stay byte-exact.
  assertEquals(normalizeCesr(tufa), normalizeCesr(reference["1"]));
  assertEquals(normalizeCesr(kli), normalizeCesr(reference["2"]));
  assertEquals(evidence(await exportFrame(tufa, 1), 1), evidence(await exportFrame(kli, 2), 2));
}
