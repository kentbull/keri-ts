# Verified observer import preservation record

Status: deferred TypeScript-specific design; the active custom import, reader and
factory are removed. The exact historical code below is preserved, without a
KERIpy parity or active implementation claim. Explicit public intake now uses
RegistryObserver with full witnessed tuple anchors and per-event acceptance;
IPEX assembles accepted chains through RegistryStore. Old accepted digest-only
prefixes remain byte-readable, but do not prove new intake acceptance.
See the [upstream integration gap](UPSTREAM_REGISTRY_GAPS.md).
Source: [58770ad0:packages/keri/src/db/registry-evidence.ts](https://github.com/kentbull/keri-ts/blob/58770ad02b166bfb4c1e551b91ee4f071051f382/packages/keri/src/db/registry-evidence.ts).
UTF-8 SHA-256: `292219eb69e0f96c11bc420bdf13a69ac7db8586ec07bc73f1542e671ccac04f`.
The full module below preserves layout, API, defaults and acquisition cleanup;
the subsequent name-only refactor uses `vet` instead of `vetRegistry`.

## Boundaries and rationale

`RegistryEvidenceStore` owns one LMDB environment. Parsed Serders, the accepted
KEL Baser and optional source hints are borrowed. Reading assembles accepted
`tels.` ordinals through `heds.`, using bodies from `evts.`. Missing head is a
missing dependency; missing accepted bodies/ordinals or a disagreeing head is
corrupt durable state. The default event ceiling is 16,384 including inception.
It bounds one collected chain, not native row allocation or total runtime memory.

Import performs the accepted-chain read, SAID-deduplicated union, merged-limit
check, complete-chain verification and all writes inside one synchronous registry
LMDB transaction. The separate KEL store is borrowed; this is not a transaction
across both environments. No asynchronous work occurs inside that transaction.
Only a `verified` decision publishes event bodies, accepted ordinals and head.
`missing`/`reject` publish nothing; errors propagate and abort writes. Retaining
the existing suffix prevents an older supplied prefix from downgrading the head.
Source hints are not persisted by this import. No parser dispatch is installed.

The factory owns acquisition until delivery; failures/cancellation join close.
After delivery the caller owns close. Runtime defaults add an Effection resource
scope, while injected stores remain caller-owned. Reopening rebinds table handles.

Existing assertions to preserve when replacing intake:

- [Storage test][storage]: missing anchors publish nothing; anchored prefix and
  later complete chain; no downgrade; deduplication; finite limit; close/reopen;
  wrong prior rejection without changing the accepted head.
- [IPEX test][ipex]: registry dependency escrow survives reopen, accepted observer
  evidence enables retry, and a missing node disclosure still fails independently.
- [Ownership test][ownership]: borrowed/default/readonly stores, partial
  construction, cancellation and harmless cleanup after explicit close.

## Frozen reference boundary

At upstream `927c0cb8794d7c84fc17143c67df64aab9deda6c`,
`acdc/registering.py:RegistryStore.accept` performs storage writes, while
`acdc/regeventing.py:_RegEventer` validates local events and anchors through a
controlling Hab. `IpexHandler._registryEvidence` reads accepted ordinals.
`tests/acdc/test_ipexing.py` directly calls recipient `store.accept` to simulate
learning an issuer TEL (for example lines 4263–4266); those calls do not prove a
production foreign-evidence intake path. `core/parsing.py` rejects nonempty ACDC
ilks rather than dispatching `rip`/`bup` to that engine. These source observations
leave R10's public intake correspondence unresolved; do not replace the existing
validation workflow with direct accepted-row writes to make its tests pass.

## Exact module

```ts
/** Durable verifier-side v2 registry evidence; distinct from legacy Reger state. */
import { ResourceLimitError, Saider, SerderACDC } from "cesr-ts";
import type { Operation } from "effection";
import { type RegistryEvidence, type RegistryVerification, vetRegistry } from "../acdc/regeventing.ts";
import { DatabaseOperationError } from "../core/errors.ts";
import { LMDBer, type LMDBerOptions } from "./core/lmdber.ts";
import { CesrOnSuber, CesrSuber, SerderSuber } from "./subing.ts";

/** Parsed, contiguous evidence borrowed by an IPEX verifier. */
export interface RegistryChain {
  rip: SerderACDC;
  updates: readonly SerderACDC[];
}
/** A caller-owned source of previously verified registry chains. */
export interface RegistryEvidenceReader {
  read(regid: string): RegistryChain | null;
}
/** Existing finite item policy applies to a single registry evidence load. */
export interface RegistryEvidenceStoreOptions extends LMDBerOptions {
  compat?: boolean;
  maxEvents?: number;
}

/**
 * Store accepted observer evidence in the frozen RegBaser evts/tels/heds layout.
 * importEvidence verifies the complete merged chain before any durable write.
 * This is not the issuer's local registry engine or an automatic parser route.
 */
export class RegistryEvidenceStore extends LMDBer implements RegistryEvidenceReader {
  private events!: SerderSuber<SerderACDC>;
  private sequence!: CesrOnSuber<Saider>;
  private heads!: CesrSuber<Saider>;
  private readonly maxEvents: number;

  constructor(options: RegistryEvidenceStoreOptions = {}) {
    super(options, {
      tailDirPath: "keri/acdc/reg",
      cleanTailDirPath: "keri/clean/acdc/reg",
      altTailDirPath: options.compat ? ".keri/acdc/reg" : ".tufa/acdc/reg",
      altCleanTailDirPath: options.compat ? ".keri/clean/acdc/reg" : ".tufa/clean/acdc/reg",
      tempPrefix: "keri_acdc_reg_",
    });
    this.maxEvents = options.maxEvents ?? 16384;
    if (!Number.isSafeInteger(this.maxEvents) || this.maxEvents < 1) {
      throw new RangeError("Registry maxEvents must be a positive safe integer.");
    }
  }

  /** Rebind typed readers after the environment's joined lifecycle opens it. */
  override *reopen(options: Partial<RegistryEvidenceStoreOptions> = {}): Operation<boolean> {
    const opened = yield* super.reopen(options);
    if (!opened) return false;
    try {
      this.events = new SerderSuber(this, { subkey: "evts.", ctor: SerderACDC });
      this.sequence = new CesrOnSuber(this, { subkey: "tels.", ctor: Saider });
      this.heads = new CesrSuber(this, { subkey: "heds.", ctor: Saider });
      return true;
    } catch (error) {
      yield* this.close();
      throw error;
    }
  }

  /** Read a complete accepted chain; corrupt acceptance markers are infrastructure errors. */
  read(regid: string): RegistryChain | null {
    const head = this.heads.get(regid);
    if (!head) return null;
    const event = this.events.get(head.qb64);
    if (!event) throw new DatabaseOperationError("Registry head body is missing.");
    const last = BigInt(`0x${event.sad!.n}`);
    if (last >= BigInt(this.maxEvents)) {
      throw new ResourceLimitError("Registry evidence exceeds configured event limit.");
    }
    const events: SerderACDC[] = [];
    for (let sn = 0; sn <= Number(last); sn++) {
      const said = this.sequence.getOn(regid, sn);
      const item = said ? this.events.get(said.qb64) : null;
      if (!item) throw new DatabaseOperationError("Accepted registry evidence has a missing sequence entry.");
      events.push(item);
    }
    if (events.at(-1)!.said !== head.qb64) throw new DatabaseOperationError("Registry head and sequence disagree.");
    return { rip: events[0], updates: events.slice(1) };
  }

  /** Verify and atomically import supplied observer evidence without downgrading a newer head. */
  importEvidence(
    { rip, updates = [], db, sources }: Pick<RegistryEvidence, "rip" | "updates" | "db" | "sources">,
  ): RegistryVerification {
    if (updates.length >= this.maxEvents) {
      throw new ResourceLimitError("Registry evidence exceeds configured event limit.");
    }
    if (!this.env) throw new DatabaseOperationError("Registry evidence environment is closed.");
    return this.env.transactionSync(() => {
      const existing = rip.said ? this.read(rip.said) : null;
      const merged = [
        ...new Map([...(existing?.updates ?? []), ...updates].map((event) => [event.said, event])).values(),
      ];
      if (merged.length >= this.maxEvents) {
        throw new ResourceLimitError("Registry evidence exceeds configured event limit.");
      }
      const result = vetRegistry({ rip, updates: merged, db, sources });
      if (result.kind !== "verified") return result;
      for (const event of [rip, ...merged]) {
        const said = new Saider({ qb64: event.said! });
        this.events.pin(event.said!, event);
        this.sequence.putOn(result.state.regid, Number(BigInt(`0x${event.sad!.n}`)), said);
      }
      this.heads.pin(result.state.regid, new Saider({ qb64: result.state.said }));
      return result;
    });
  }
}

/** Open an explicitly owned registry evidence store; the runtime must join its close. */
export function* createRegistryEvidenceStore(
  options: RegistryEvidenceStoreOptions = {},
): Operation<RegistryEvidenceStore> {
  const store = new RegistryEvidenceStore(options);
  let delivered = false;
  try {
    yield* store.reopen();
    delivered = true;
    return store;
  } finally {
    // Acquisition owns the store until it returns; aborts and failures join cleanup.
    if (!delivered) yield* store.close(store.temp);
  }
}
```

[storage]: https://github.com/kentbull/keri-ts/blob/58770ad02b166bfb4c1e551b91ee4f071051f382/packages/keri/test/unit/db/registry-evidence.test.ts
[ipex]: https://github.com/kentbull/keri-ts/blob/58770ad02b166bfb4c1e551b91ee4f071051f382/packages/keri/test/unit/app/ipex/ipex-v2.test.ts
[ownership]: https://github.com/kentbull/keri-ts/blob/58770ad02b166bfb4c1e551b91ee4f071051f382/packages/keri/test/unit/app/runtime/runtime-store-ownership.test.ts
