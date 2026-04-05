import { run } from "effection";
import { assertEquals, assertInstanceOf, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { Cigar, SerderKERI, Siger, smell, Verfer } from "../../../../cesr/mod.ts";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { createHabery, SIGNER } from "../../../src/app/habbing.ts";
import { ValidationError } from "../../../src/core/errors.ts";
import { dgKey } from "../../../src/db/core/keys.ts";

Deno.test("Habery eagerly loads persisted habitats on open", async () => {
  const name = `habery-load-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;
  const alias = "alice";

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
    });
    try {
      const hab = hby.makeHab(alias, undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      assertEquals(hby.habs.get(hab.pre)?.name, alias);
      const storedHab = hby.db.getHab(hab.pre);
      assertEquals(storedHab?.hid, hab.pre);
      assertEquals(storedHab?.name, alias);
      assertEquals(storedHab ? "sigs" in storedHab : false, false);
      const state = hby.db.getState(hab.pre);
      assertEquals(state?.i, hab.pre);
      assertEquals(state?.k, hab.kever?.verfers.map((verfer) => verfer.qb64));
      assertEquals(hby.db.kels.getLast(hab.pre, 0), state?.d);
      assertEquals(hby.db.getFel(hab.pre, 0), state?.d);
      assertEquals(hab.accepted, true);
      assertEquals(hby.db.getKever(hab.pre)?.pre, hab.pre);
      assertEquals(hby.prefixes.includes(hab.pre), true);
      assertStrictEquals(hab.kevery, hby.kevery);

      const evt = state?.d ? hby.db.getEvt(dgKey(hab.pre, state.d)) : null;
      const evtText = evt ? new TextDecoder().decode(evt) : "";
      const match = evtText.match(/"d":"([^"]+)"/);
      if (!match) {
        throw new Error("Expected inception event SAID in stored event.");
      }
      const said = match[1];
      assertEquals(hab.pre, said);
      assertEquals(hby.db.getSigs(hab.pre, said).length, 1);
      if (!evt) {
        throw new Error("Expected stored inception event bytes.");
      }
      assertEquals(smell(evt).smellage.size, evt.length);
      const evtSerder = hby.db.getEvtSerder(hab.pre, said);
      assertEquals(evtSerder instanceof SerderKERI, true);
      assertEquals(evtSerder?.pre, hab.pre);
      assertEquals(evtSerder?.said, said);
    } finally {
      yield* hby.close();
    }
  });

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
    });
    try {
      assertEquals(hby.habs.size, 1);
      const hab = [...hby.habs.values()][0];
      assertEquals(hab?.name, alias);
      assertEquals(hby.habByName(alias)?.pre, hab?.pre);
      assertEquals(hab?.kever?.pre, hab?.pre);
      assertEquals(hab?.accepted, true);
      assertEquals(hby.prefixes.includes(hab?.pre ?? ""), true);
      assertStrictEquals(hab?.kevery, hby.kevery);
      const storedHab = hab ? hby.db.getHab(hab.pre) : null;
      assertEquals(storedHab?.hid, hab?.pre);
      assertEquals(storedHab?.name, alias);
      assertEquals(storedHab ? "sigs" in storedHab : false, false);
      const state = hab ? hby.db.getState(hab.pre) : null;
      assertEquals(state?.i, hab?.pre);
      assertEquals(state?.k, hab?.kever?.verfers.map((verfer) => verfer.qb64));
      assertEquals(
        hab ? hby.db.getKever(hab.pre)?.pre : null,
        hab?.pre ?? null,
      );
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("Habery keeps a local kevery separate from runtime-owned kevery cues", async () => {
  const name = `habery-local-kevery-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipSignator: true,
    });
    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const runtime = createAgentRuntime(hby, { mode: "local" });

      assertStrictEquals(hab.kevery, hby.kevery);
      assertStrictEquals(hby.kevery.local, true);
      assertStrictEquals(hby.kevery.lax, false);
      assertStrictEquals(runtime.reactor.kevery.cues, runtime.cues);
      assertEquals(runtime.reactor.kevery === hby.kevery, false);
      assertEquals(runtime.cues === hby.kevery.cues, false);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("Habery inception keeps non-transferable prefix equal to the signing key", async () => {
  const name = `habery-nontrans-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
    });
    try {
      const hab = hby.makeHab("bob", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const state = hby.db.getState(hab.pre);
      assertEquals(hab.pre, state?.k?.[0]);
      assertEquals(hab.pre.startsWith("B"), true);
      assertEquals(state?.n ?? [], []);
      assertEquals(state?.b ?? [], []);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("Habery inception keeps non-transferable ECDSA prefixes equal to the signing key", async () => {
  const name = `habery-nontrans-r1-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
    });
    try {
      const hab = hby.makeHab("bob-r1", undefined, {
        transferable: false,
        icode: "Q",
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const state = hby.db.getState(hab.pre);

      assertEquals(hab.pre, state?.k?.[0]);
      assertEquals(hab.pre.startsWith("1AAI"), true);
      assertEquals(state?.n ?? [], []);
      assertEquals(state?.b ?? [], []);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("Habery inception honors digestive prefix codex overrides for i", async () => {
  const name = `habery-sha2-prefix-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
    });
    try {
      const hab = hby.makeHab("carol", undefined, {
        code: "I",
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const state = hby.db.getState(hab.pre);
      assertEquals(hab.pre.startsWith("I"), true);
      assertEquals(state?.d?.startsWith("E"), true);
      assertEquals(hab.pre === state?.k?.[0], false);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("Habery inception persists weighted and nested threshold state", async () => {
  const name = `habery-weighted-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;
  const nested = [{ "1": ["1/2", "1/2"] }];

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
    });
    try {
      const hab = hby.makeHab("weighted", undefined, {
        transferable: true,
        icount: 2,
        isith: ["1/2", "1/2"],
        ncount: 2,
        nsith: nested,
        toad: 0,
      });
      const state = hby.db.getState(hab.pre);

      assertEquals(state?.kt, ["1/2", "1/2"]);
      assertEquals(state?.nt, nested);
      assertEquals(hab.kever?.tholder?.sith, ["1/2", "1/2"]);
      assertEquals(hab.kever?.tholder?.weighted, true);
      assertEquals(hab.kever?.ntholder?.sith, nested);
      assertEquals(hab.kever?.ntholder?.weighted, true);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("Hab and Signator signing keep indexed and unindexed overload behavior intact", async () => {
  const name = `habery-sign-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
    });
    try {
      const hab = hby.makeHab("dave", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const ser = new TextEncoder().encode("hab-signatures");

      const indexed = hab.sign(ser, true);
      const unindexed = hab.sign(ser, false);
      const signatorSig = hby.signator?.sign(ser);

      assertEquals(indexed.length, 1);
      assertEquals(unindexed.length, 1);
      assertInstanceOf(indexed[0], Siger);
      assertInstanceOf(unindexed[0], Cigar);
      assertEquals(indexed[0]?.index, 0);
      assertInstanceOf(signatorSig, Cigar);
      assertInstanceOf(hby.signator?.verfer, Verfer);
      assertEquals(hby.signator?.verfer.qb64, hby.signator?.pre);
      assertEquals(
        hby.signator?.verfer.qb64,
        hby.signator?.hab.kever?.verfers[0]?.qb64,
      );
      assertEquals(
        signatorSig ? hby.signator?.verify(ser, signatorSig) : false,
        true,
      );
      assertEquals(
        signatorSig
          ? hby.signator?.verify(
            new TextEncoder().encode("wrong-message"),
            signatorSig,
          )
          : true,
        false,
      );
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("Hab witness helper emits receipt bytes but skips own-event local witness storage", async () => {
  const name = `habery-witness-receipts-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
    });
    try {
      const witness = hby.makeHab("wit", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const controller = hby.makeHab("ctrl", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        wits: [witness.pre],
        toad: 1,
      });
      const event = hby.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      if (!event?.said) {
        throw new Error("Expected accepted controller inception event.");
      }

      const witnessMsg = witness.witness(event);

      assertEquals(witnessMsg.length > 0, true);
      assertEquals(
        hby.db.wigs.get([controller.pre, event.said]).length,
        0,
      );
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("Hab non-transferable receipt helper emits receipt bytes but skips own-event local receipt stores", async () => {
  const name = `habery-nontrans-receipts-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
    });
    try {
      const receiptor = hby.makeHab("receiptor", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const controller = hby.makeHab("ctrl", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const event = hby.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      if (!event?.said) {
        throw new Error("Expected accepted controller inception event.");
      }

      const receiptMsg = receiptor.receipt(event);

      assertEquals(receiptMsg.length > 0, true);
      assertEquals(
        hby.db.rcts.get([controller.pre, event.said]).length,
        0,
      );
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("Hab transferable receipt helper rejects own-event local receipts under non-lax Habery semantics", async () => {
  const name = `habery-validator-receipts-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
    });
    try {
      const validator = hby.makeHab("val", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const controller = hby.makeHab("ctrl", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const event = hby.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      if (!event?.said) {
        throw new Error("Expected accepted controller inception event.");
      }

      assertThrows(
        () => validator.receipt(event),
        ValidationError,
      );
      assertEquals(hby.db.vrcs.get([controller.pre, event.said]).length, 0);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("encrypted Habery reopens its signator and signs with the same passcode", async () => {
  const name = `habery-enc-signator-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;
  const bran = "MyPasscodeARealSecret";
  let signatoryPre = "";

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
      bran,
    });
    try {
      hby.makeHab("erin", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const ser = new TextEncoder().encode("encrypted-signator");
      const sig = hby.signator?.sign(ser);

      signatoryPre = hby.db.getHby(SIGNER) ?? "";
      assertInstanceOf(sig, Cigar);
      assertInstanceOf(hby.signator?.verfer, Verfer);
      assertEquals(hby.signator?.verfer.qb64, signatoryPre);
      assertEquals(
        sig ? hby.signator?.verify(ser, sig) : false,
        true,
      );
      assertEquals(signatoryPre.length > 0, true);
    } finally {
      yield* hby.close();
    }
  });

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
      bran,
    });
    try {
      const ser = new TextEncoder().encode("encrypted-signator-reopen");
      const sig = hby.signator?.sign(ser);

      assertEquals(hby.signator?.pre, signatoryPre);
      assertEquals(hby.db.getHby(SIGNER), signatoryPre);
      assertInstanceOf(sig, Cigar);
      assertInstanceOf(hby.signator?.verfer, Verfer);
      assertEquals(hby.signator?.verfer.qb64, signatoryPre);
      assertEquals(
        hby.signator?.verfer.qb64,
        hby.signator?.hab.kever?.verfers[0]?.qb64,
      );
      assertEquals(
        sig ? hby.signator?.verify(ser, sig) : false,
        true,
      );
    } finally {
      yield* hby.close();
    }
  });

  await assertRejects(
    () =>
      run(function*() {
        const hby = yield* createHabery({
          name,
          headDirPath,
          bran: "WrongPasscodeSecretAB",
        });
        try {
          hby.signator?.sign(new TextEncoder().encode("wrong-passcode"));
        } finally {
          yield* hby.close();
        }
      }),
    Error,
    "Last seed missing or provided last seed not associated",
  );
});
