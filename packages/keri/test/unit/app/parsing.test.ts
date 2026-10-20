import { run } from "effection";
import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert";
import {
  loadInceptFileOptions,
  loadRotateFileOptions,
  parseBooleanOption,
  parseCountOption,
  parseExnDataItems,
  parseNumberOption,
  parseStringListOption,
  parseThresholdOption,
} from "../../../src/app/cli/common/parsing.ts";
import { inceptCommand } from "../../../src/app/cli/incept.ts";
import { initCommand } from "../../../src/app/cli/init.ts";
import { multisigInceptCommand, multisigJoinCommand, multisigRotateCommand } from "../../../src/app/cli/multisig.ts";
import { rotateCommand } from "../../../src/app/cli/rotate.ts";
import { createHabery } from "../../../src/app/habbing.ts";

Deno.test("parseExnDataItems matches KERIpy-style coercion and merge order", () => {
  const parsed = parseExnDataItems([
    "count=1",
    "enabled=true",
    "tags=[\"a\",\"b\"]",
    "meta={\"x\":1}",
    "note=hello",
    "{\"count\":2,\"extra\":\"json\"}",
    "empty=null",
  ]);

  assertEquals(parsed, {
    count: 2,
    enabled: true,
    tags: ["a", "b"],
    meta: { x: 1 },
    note: "hello",
    extra: "json",
    empty: null,
  });
});

Deno.test("parseExnDataItems loads object payloads from @file references", () => {
  const dir = Deno.makeTempDirSync();
  const path = `${dir}/payload.json`;
  Deno.writeTextFileSync(
    path,
    JSON.stringify({
      route: "challenge",
      nested: { ok: true },
    }),
  );

  try {
    const parsed = parseExnDataItems([`@${path}`, "route=overridden"]);
    assertEquals(parsed, {
      route: "overridden",
      nested: { ok: true },
    });
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("parseThresholdOption accepts CLI and JSON-file threshold forms", () => {
  const structured = [{ "1": ["1/2", "1/2"] }, "1"];

  assertEquals(parseThresholdOption(2), "2");
  assertEquals(parseThresholdOption("2"), "2");
  assertEquals(parseThresholdOption(JSON.stringify(structured)), structured);
  assertEquals(parseThresholdOption(structured), structured);
  assertEquals(parseThresholdOption(undefined), undefined);
  assertThrows(() => parseThresholdOption(null));
});

Deno.test("CLI primitives preserve omission and explicit zero, false and empty lists", () => {
  assertEquals(parseBooleanOption(undefined, "flag"), undefined);
  assertEquals(parseBooleanOption(false, "flag"), false);
  assertEquals(parseCountOption(undefined, "count"), undefined);
  assertEquals(parseCountOption("0", "count"), 0);
  assertEquals(parseStringListOption(undefined, "wits"), undefined);
  assertEquals(parseStringListOption([], "wits"), []);
  for (const value of ["", " ", "1e2", "0x10", "1.5", -1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, null]) {
    assertThrows(() => parseCountOption(value, "count"));
  }
  assertThrows(() => parseBooleanOption("false", "flag"));
  assertThrows(() => parseStringListOption(["valid", 3], "wits"));
  for (const value of ["", [], ["not-a-weight"], [["1/2"]], Number.MAX_SAFE_INTEGER + 1]) {
    assertThrows(() => parseThresholdOption(value));
  }
});

Deno.test("lifecycle option files validate supplied fields without filtering malformed entries", () => {
  const file = Deno.makeTempFileSync();
  try {
    Deno.writeTextFileSync(file, JSON.stringify({ transferable: true, ncount: 0, wits: [], data: [{ custom: true }] }));
    const inception = loadInceptFileOptions(file);
    assertEquals(inception.transferable, true);
    assertEquals(inception.ncount, 0);
    assertEquals(inception.wits, []);
    assertEquals(inception.data, [{ custom: true }]);
    for (const value of [null, [], { wits: ["valid", 3] }, { ncount: -1 }, { data: false }, { nsith: "" }]) {
      Deno.writeTextFileSync(file, JSON.stringify(value));
      assertThrows(() => loadInceptFileOptions(file));
      assertThrows(() => loadRotateFileOptions(file));
    }
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("decimal quantities preserve fractional seconds and reject implicit coercion", () => {
  assertEquals(parseNumberOption(undefined, "seconds"), undefined);
  assertEquals(parseNumberOption("0", "seconds"), 0);
  assertEquals(parseNumberOption("0.25", "seconds"), 0.25);
  for (const value of [null, "", " ", false, [], "0x10", Infinity, "1e999"]) {
    assertThrows(() => parseNumberOption(value, "seconds"));
  }
});

Deno.test("multisig input validation rejects malformed members and timeouts before storage", async () => {
  const root = Deno.makeTempDirSync();
  const file = `${root}/group.json`;
  const headDirPath = `${root}/store`;
  try {
    for (const field of ["aids", "rmids", "wits"]) {
      Deno.writeTextFileSync(file, JSON.stringify({ aids: ["member"], [field]: ["member", 7] }));
      const error = await assertRejects(() =>
        run(() =>
          multisigInceptCommand({
            name: "missing",
            alias: "member",
            group: "group",
            file,
            headDirPath,
          })
        )
      );
      assertInstanceOf(error, Error);
      assertStringIncludes(error.message, field);
    }
    for (const approvalTimeoutSeconds of [null, "", false, -1, Infinity, 1e308]) {
      const error = await assertRejects(() =>
        run(() =>
          multisigJoinCommand({
            name: "missing",
            headDirPath,
            approvalTimeoutSeconds,
          })
        )
      );
      assertInstanceOf(error, Error);
      assertStringIncludes(error.message, "approval timeout seconds");
    }
    assertThrows(() => Deno.statSync(headDirPath), Deno.errors.NotFound);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("multisig commands retain file data and accept explicit empty data overrides", async () => {
  const headDirPath = Deno.makeTempDirSync();
  const name = `multisig-options-${crypto.randomUUID()}`;
  const file = `${headDirPath}/group.json`;
  const store = { name, headDirPath };
  try {
    await run(() => initCommand({ ...store, nopasscode: true }));
    await run(() => inceptCommand({ ...store, alias: "member", transferable: true }));
    const pre = await run(function*() {
      const hby = yield* createHabery({ ...store, skipConfig: true });
      try {
        return hby.habByName("member")!.pre;
      } finally {
        yield* hby.close();
      }
    });
    Deno.writeTextFileSync(
      file,
      JSON.stringify({
        aids: [pre],
        rmids: [pre],
        isith: "1",
        nsith: "1",
        data: [{ origin: "file" }],
      }),
    );
    const created = await run(() =>
      multisigInceptCommand({
        ...store,
        alias: "member",
        group: "group",
        file,
        approvalTimeoutSeconds: "0.25",
      })
    );
    assertEquals(created.accepted, true);
    Deno.writeTextFileSync(file, JSON.stringify({ isith: "1", nsith: "1", data: [{ rotation: "file" }] }));
    await run(() => rotateCommand({ ...store, alias: "member" }));
    const rotated = await run(() =>
      multisigRotateCommand({
        ...store,
        group: "group",
        file,
        approvalTimeoutSeconds: 0,
      })
    );
    assertEquals(rotated.accepted, true);
    const rotatedSaid = rotated.state?.d;
    assertExists(rotatedSaid);
    await run(function*() {
      const hby = yield* createHabery({ ...store, skipConfig: true });
      try {
        assertEquals(hby.db.getEvtSerder(rotated.group, rotatedSaid)?.ked?.a, [{ rotation: "file" }]);
      } finally {
        yield* hby.close();
      }
    });
    // Rotate the member's precommitted keys before the group's next rotation.
    await run(() => rotateCommand({ ...store, alias: "member" }));
    const cleared = await run(() =>
      multisigRotateCommand({
        ...store,
        group: "group",
        file,
        data: [],
        approvalTimeoutSeconds: 0,
      })
    );
    assertEquals(cleared.accepted, true);
    const clearedSaid = cleared.state?.d;
    assertExists(clearedSaid);
    await run(function*() {
      const hby = yield* createHabery({ ...store, skipConfig: true });
      try {
        assertEquals(hby.db.getEvtSerder(cleared.group, clearedSaid)?.ked?.a, []);
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    Deno.removeSync(headDirPath, { recursive: true });
  }
});
