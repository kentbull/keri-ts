import { assertEquals } from "jsr:@std/assert";
import { createParser } from "../../src/core/parser-engine.ts";
import { intToB64 } from "../../src/core/bytes.ts";
import type { CesrFrame } from "../../src/core/types.ts";
import { CtrDexV2 } from "../../src/tables/counter-codex.ts";
import { COUNTER_SIZES_V2 } from "../../src/tables/counter.tables.generated.ts";

function encode(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function v2ify(raw: string): string {
  const size = encode(raw).length;
  const sizeHex = size.toString(16).padStart(6, "0");
  return raw.replace("KERI20JSON000000_", `KERI20JSON${sizeHex}_`);
}

function counterV2(code: string, count: number): string {
  const sizage = COUNTER_SIZES_V2.get(code);
  if (!sizage) throw new Error(`Unknown v2 counter code ${code}`);
  return `${code}${intToB64(count, sizage.ss)}`;
}

function sigerToken(): string {
  return `A${"A".repeat(87)}`;
}

function summarizeFrames(events: CesrFrame[]): string[] {
  const errors = events.filter((event) => event.type === "error");
  assertEquals(errors.length, 0);
  return events
    .filter((event) => event.type === "frame")
    .map((event) => {
      if (event.type !== "frame") return "";
      const body = event.frame.body;
      const attachments = event.frame.attachments
        .map((attachment) => `${attachment.code}:${attachment.count}`)
        .join(",");
      return `${body.kind}|${body.ilk ?? ""}|${body.said ?? ""}|${attachments}`;
    });
}

Deno.test("V-P1-009: boundary-shortage matrix is deterministic at header/mid/just-before-complete cuts", () => {
  const body = v2ify('{"v":"KERI20JSON000000_","t":"icp","d":"Eabc"}');
  const attachment = `${counterV2(CtrDexV2.ControllerIdxSigs, 1)}${sigerToken()}`;
  const stream = `${body}${attachment}`;
  const bytes = encode(stream);

  const baselineParser = createParser();
  const baseline = summarizeFrames([
    ...baselineParser.feed(bytes),
    ...baselineParser.flush(),
  ]);

  const cuts = [
    body.length + 4, // exactly after attachment counter header
    body.length + 4 + (sigerToken().length / 2), // mid attachment payload
    bytes.length - 1, // one byte before completion
  ];

  for (const cut of cuts) {
    const parser = createParser({
      onAttachmentVersionFallback: () => {
        // Keep shortage-matrix assertions focused and log-noiseless.
      },
    });
    const first = parser.feed(bytes.slice(0, cut));
    const firstErrors = first.filter((event) => event.type === "error");
    assertEquals(firstErrors.length, 0);

    const events = [
      ...first,
      ...parser.feed(bytes.slice(cut)),
      ...parser.flush(),
    ];
    assertEquals(summarizeFrames(events), baseline);
  }
});
