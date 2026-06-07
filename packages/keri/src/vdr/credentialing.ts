/**
 * Registry-backed credential issuance orchestration.
 *
 * KERIpy correspondence:
 * - mirrors the single-sig portions of `keri.vdr.credentialing`
 * - keeps registry/TEL ownership in `Reger` + `Tevery`
 * - keeps credential validation/save ownership in `Verifier`
 *
 * Current boundary:
 * - multisig/counselor and network dissemination escrows are represented by
 *   KERIpy-shaped stores, but only the local single-sig path completes here.
 */
import {
  concatBytes,
  Counter,
  CtrDexV1,
  Diger,
  Ilks,
  type Kind,
  Kinds,
  NumberPrimitive,
  NumDex,
  Prefixer,
  Saider,
  Seqner,
  SerderACDC,
  SerderKERI,
  TraitDex,
  type Versionage,
} from "../../../cesr/mod.ts";
import type { AgentCue } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { ValidationError } from "../core/errors.ts";
import {
  backerIssue,
  backerRevoke,
  incept as inceptRegistryEvent,
  issue as issueEvent,
  revoke as revokeEvent,
  rotate as rotateRegistryEvent,
} from "../core/protocol-vdr-eventing.ts";
import { RegistryRecord } from "../core/records.ts";
import type { Reger } from "../db/reger.ts";
import { makeNowIso8601 } from "../time/mod.ts";
import type { Hab, Habery } from "../app/habbing.ts";
import { resolveCachedSchema } from "../app/schema-resolving.ts";
import { Verifier, type VerifierDecision } from "../app/verifying.ts";
import { type TelProcessDecision, Tevery } from "./eventing.ts";

const KERI_V1 = Object.freeze({ major: 1, minor: 0 } as const);

export interface RegeryOptions {
  reger: Reger;
  tvy?: Tevery;
  vry?: Verifier;
  cues?: Deck<AgentCue>;
}

export interface RegistryOptions {
  name: string;
  hab: Hab;
  reger: Reger;
  tvy: Tevery;
  cues?: Deck<AgentCue>;
  regk?: string;
  noBackers?: boolean;
  estOnly?: boolean;
}

export interface RegistryInceptOptions {
  noBackers?: boolean;
  estOnly?: boolean;
  nonce?: string;
  baks?: string[];
  toad?: number | string;
}

export interface CredentialBuildOptions {
  issuer: string;
  registry: string;
  schema: string;
  data?: Record<string, unknown> | string;
  recipient?: string;
  edges?: Record<string, unknown> | Record<string, unknown>[];
  rules?: Record<string, unknown> | Record<string, unknown>[];
  private?: boolean;
  privateCredentialNonce?: string;
  privateSubjectNonce?: string;
  dt?: string;
  version?: Versionage;
  kind?: Kind;
}

export interface CredentialerOptions {
  reger: Reger;
  vry: Verifier;
  cues?: Deck<AgentCue>;
}

export interface CredentialIssueResult {
  creder: SerderACDC;
  tel: SerderKERI;
  telDecision: TelProcessDecision;
  verifierDecision: VerifierDecision;
}

export interface AnchorSeal {
  prefixer: Prefixer;
  seqner: NumberPrimitive;
  saider: Diger;
}

function ordinal(num: number | bigint): NumberPrimitive {
  const raw = new Uint8Array(16);
  let value = BigInt(num);
  for (let i = raw.length - 1; i >= 0; i--) {
    raw[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return new NumberPrimitive({ code: NumDex.Huge, raw });
}

function seqner(num: number | bigint): Seqner {
  const raw = new Uint8Array(16);
  let value = BigInt(num);
  for (let i = raw.length - 1; i >= 0; i--) {
    raw[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return new Seqner({ code: NumDex.Huge, raw });
}

function said(serder: { said: string | null }): string {
  if (!serder.said) {
    throw new ValidationError("Expected SAID-bearing event.");
  }
  return serder.said;
}

function requireHabPrefix(hab: Hab): string {
  if (!hab.pre) {
    throw new ValidationError("Hab must be incepted before VDR operations.");
  }
  return hab.pre;
}

function anchorTelEvent(hab: Hab, serder: SerderKERI): AnchorSeal {
  if (!serder.pre || !serder.snh || !serder.said) {
    throw new ValidationError("TEL event missing seal fields.");
  }
  hab.interact({
    data: [{ i: serder.pre, s: serder.snh, d: serder.said }],
  });
  const sn = hab.kever?.sn;
  const said = hab.kever?.said;
  if (sn === undefined || sn === null || !said) {
    throw new ValidationError("Failed to anchor TEL event in issuer KEL.");
  }
  return {
    prefixer: new Prefixer({ qb64: requireHabPrefix(hab) }),
    seqner: ordinal(sn),
    saider: new Diger({ qb64: said }),
  };
}

function telEventSeal(serder: SerderKERI): AnchorSeal {
  if (!serder.pre || !serder.snh || !serder.said) {
    throw new ValidationError("TEL event missing credential seal fields.");
  }
  return {
    prefixer: new Prefixer({ qb64: serder.pre }),
    seqner: ordinal(parseInt(serder.snh, 16)),
    saider: new Diger({ qb64: serder.said }),
  };
}

function subjectAttributes(
  data: Record<string, unknown> | string | undefined,
  recipient?: string,
  dt?: string,
): Record<string, unknown> | string {
  if (typeof data === "string") {
    return data;
  }
  const attrs: Record<string, unknown> = {
    d: "",
    dt: dt ?? makeNowIso8601(),
    ...(data ?? {}),
  };
  if (recipient && typeof attrs.i !== "string") {
    attrs.i = recipient;
  }
  return attrs;
}

function optionalSection(
  value?: Record<string, unknown> | Record<string, unknown>[],
): Record<string, unknown> | Record<string, unknown>[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((item) => ({ ...item }));
  }
  return { ...value };
}

/** Build one public registry-backed ACDC credential. */
export function credential({
  issuer,
  registry,
  schema,
  data,
  recipient,
  edges,
  rules,
  private: privateCredential = false,
  privateCredentialNonce,
  privateSubjectNonce,
  dt,
  version,
  kind = Kinds.json,
}: CredentialBuildOptions): SerderACDC {
  const sad: Record<string, unknown> = {
    d: "",
    i: issuer,
    ri: registry,
    s: schema,
    a: subjectAttributes(data, recipient, dt),
  };
  if (privateCredential || privateCredentialNonce) {
    sad.u = privateCredentialNonce ?? crypto.randomUUID();
  }
  if (privateSubjectNonce && typeof sad.a === "object" && sad.a !== null) {
    (sad.a as Record<string, unknown>).u = privateSubjectNonce;
  }
  const edgeSection = optionalSection(edges);
  if (edgeSection !== undefined) {
    sad.e = edgeSection;
  }
  const ruleSection = optionalSection(rules);
  if (ruleSection !== undefined) {
    sad.r = ruleSection;
  }
  return new SerderACDC({
    sad,
    pvrsn: version,
    kind,
    makify: true,
  });
}

/** Serialize one ACDC plus the KERIpy grant/export seal-source triple. */
export function serializeCredential(
  creder: SerderACDC,
  prefixer: Prefixer,
  seqner: NumberPrimitive | Seqner,
  saider: Diger,
): Uint8Array {
  const actualSeqner = seqner instanceof Seqner ? seqner : new Seqner({ code: NumDex.Huge, raw: seqner.raw });
  return concatBytes(
    creder.raw,
    new Counter({
      code: CtrDexV1.SealSourceTriples,
      count: 1,
      version: KERI_V1,
    }).qb64b,
    prefixer.qb64b,
    actualSeqner.qb64b,
    saider.qb64b,
  );
}

/** Registry collection owner for one Habery. */
export class Regery {
  readonly hby: Habery;
  readonly reger: Reger;
  readonly tvy: Tevery;
  readonly vry: Verifier;
  readonly cues: Deck<AgentCue>;
  readonly registries = new Map<string, Registry>();

  constructor(hby: Habery, options: RegeryOptions) {
    this.hby = hby;
    this.reger = options.reger;
    this.cues = options.cues ?? new Deck<AgentCue>();
    this.tvy = options.tvy ?? new Tevery({ db: hby.db, reger: this.reger, cues: this.cues });
    this.vry = options.vry ?? new Verifier(hby, { reger: this.reger, cues: this.cues });
    this.loadRegistries();
  }

  loadRegistries(): void {
    for (const [keys, record] of this.reger.regs.getTopItemIter()) {
      const name = keys[0];
      if (!name || !record.registryKey) {
        continue;
      }
      const hab = this.hby.habByName(record.prefix) ?? this.hby.habs.get(record.prefix) ?? null;
      if (!hab) {
        continue;
      }
      this.registries.set(
        name,
        new Registry({
          name,
          hab,
          reger: this.reger,
          tvy: this.tvy,
          cues: this.cues,
          regk: record.registryKey,
        }),
      );
    }
  }

  makeRegistry(
    name: string,
    hab: Hab,
    options: RegistryInceptOptions = {},
  ): Registry {
    const registry = new Registry({
      name,
      hab,
      reger: this.reger,
      tvy: this.tvy,
      cues: this.cues,
    });
    registry.incept(options);
    this.registries.set(name, registry);
    return registry;
  }

  registryByName(name: string): Registry | null {
    return this.registries.get(name) ?? null;
  }

  processEscrows(): void {
    this.tvy.processEscrows();
    this.vry.processEscrows();
  }
}

/** One credential registry controlled by one issuer habitat. */
export class Registry {
  readonly name: string;
  readonly hab: Hab;
  readonly reger: Reger;
  readonly tvy: Tevery;
  readonly cues: Deck<AgentCue>;
  regk: string | null;
  noBackers: boolean;
  estOnly: boolean;

  constructor(options: RegistryOptions) {
    this.name = options.name;
    this.hab = options.hab;
    this.reger = options.reger;
    this.tvy = options.tvy;
    this.cues = options.cues ?? new Deck<AgentCue>();
    this.regk = options.regk ?? null;
    this.noBackers = options.noBackers ?? true;
    this.estOnly = options.estOnly ?? false;
  }

  incept(options: RegistryInceptOptions = {}): TelProcessDecision {
    const cnfg = [
      ...((options.noBackers ?? true) ? [TraitDex.NoBackers] : []),
      ...(options.estOnly ? [TraitDex.EstOnly] : []),
    ];
    const serder = inceptRegistryEvent(requireHabPrefix(this.hab), {
      cnfg,
      baks: options.baks,
      toad: options.toad,
      nonce: options.nonce,
    });
    const seal = anchorTelEvent(this.hab, serder);
    const decision = this.tvy.processEvent({ serder, seqner: seal.seqner, saider: seal.saider });
    if (decision.kind !== "accept") {
      throw new ValidationError(`Registry inception failed: ${decision.kind}`);
    }
    this.regk = said(serder);
    this.noBackers = cnfg.includes(TraitDex.NoBackers);
    this.estOnly = cnfg.includes(TraitDex.EstOnly);
    this.reger.registries.add(this.regk);
    this.reger.regs.pin(
      this.name,
      new RegistryRecord({
        registryKey: this.regk,
        prefix: requireHabPrefix(this.hab),
      }),
    );
    this.markComplete(this.regk, 0, said(serder));
    return decision;
  }

  rotate(options: {
    toad?: number | string;
    cuts?: string[];
    adds?: string[];
  } = {}): TelProcessDecision {
    const tever = this.currentTever();
    const serder = rotateRegistryEvent(this.requireRegk(), said(tever.serder), {
      sn: tever.sn + 1,
      toad: options.toad,
      baks: [...tever.baks],
      cuts: options.cuts,
      adds: options.adds,
    });
    const seal = anchorTelEvent(this.hab, serder);
    const decision = this.tvy.processEvent({ serder, seqner: seal.seqner, saider: seal.saider });
    if (decision.kind === "accept") {
      this.markComplete(this.requireRegk(), serder.sn ?? tever.sn + 1, said(serder));
    }
    return decision;
  }

  issue(creder: SerderACDC): { serder: SerderKERI; decision: TelProcessDecision; seal: AnchorSeal } {
    const tever = this.currentTever();
    const regk = this.requireRegk();
    const serder = tever.noBackers
      ? issueEvent(said(creder), regk)
      : backerIssue(said(creder), regk, tever.sn, said(tever.serder));
    const seal = anchorTelEvent(this.hab, serder);
    const decision = this.tvy.processEvent({ serder, seqner: seal.seqner, saider: seal.saider });
    if (decision.kind === "accept") {
      this.markComplete(said(creder), serder.sn ?? 0, said(serder));
    }
    return { serder, decision, seal };
  }

  revoke(
    credentialSaid: string,
  ): { serder: SerderKERI; decision: TelProcessDecision; seal: AnchorSeal } {
    const tever = this.currentTever();
    const prior = this.reger.tels.getOn(credentialSaid, tever.vcSn(credentialSaid) ?? 0);
    if (!prior) {
      throw new ValidationError(`Cannot revoke unknown credential ${credentialSaid}.`);
    }
    const regk = this.requireRegk();
    const serder = tever.noBackers
      ? revokeEvent(credentialSaid, regk, prior.qb64)
      : backerRevoke(credentialSaid, regk, tever.sn, said(tever.serder), prior.qb64);
    const seal = anchorTelEvent(this.hab, serder);
    const decision = this.tvy.processEvent({ serder, seqner: seal.seqner, saider: seal.saider });
    if (decision.kind === "accept") {
      this.markComplete(credentialSaid, serder.sn ?? 1, said(serder));
    }
    return { serder, decision, seal };
  }

  complete(pre: string, sn = 0): boolean {
    return this.reger.ctel.get([pre, seqner(sn).qb64]) !== null;
  }

  private markComplete(pre: string, sn: number, eventSaid: string): void {
    this.reger.ctel.pin([pre, seqner(sn).qb64], new Saider({ qb64: eventSaid }));
  }

  private requireRegk(): string {
    if (!this.regk) {
      throw new ValidationError(`Registry ${this.name} has not been incepted.`);
    }
    return this.regk;
  }

  private currentTever() {
    const tever = this.reger.tevers.get(this.requireRegk());
    if (!(tever instanceof Object) || !("serder" in tever)) {
      throw new ValidationError(`Missing TEL state for registry ${this.requireRegk()}.`);
    }
    return tever as import("./eventing.ts").Tever;
  }
}

/** Local registrar facade over the single-sig registry completion path. */
export class Registrar {
  readonly rgy: Regery;

  constructor(rgy: Regery) {
    this.rgy = rgy;
  }

  incept(registry: Registry, options: RegistryInceptOptions = {}): TelProcessDecision {
    return registry.incept(options);
  }

  issue(registry: Registry, creder: SerderACDC): TelProcessDecision {
    return registry.issue(creder).decision;
  }

  revoke(registry: Registry, credentialSaid: string): TelProcessDecision {
    return registry.revoke(credentialSaid).decision;
  }

  complete(registry: Registry, pre: string, sn = 0): boolean {
    return registry.complete(pre, sn);
  }

  processEscrows(): void {
    this.rgy.processEscrows();
  }
}

/** Create, validate, issue, and index credentials for one local registry lane. */
export class Credentialer {
  readonly hby: Habery;
  readonly reger: Reger;
  readonly vry: Verifier;
  readonly cues: Deck<AgentCue>;

  constructor(hby: Habery, options: CredentialerOptions) {
    this.hby = hby;
    this.reger = options.reger;
    this.vry = options.vry;
    this.cues = options.cues ?? new Deck<AgentCue>();
  }

  create(args: {
    registry: Registry;
    schema: string;
    data?: Record<string, unknown> | string;
    recipient?: string;
    edges?: Record<string, unknown> | Record<string, unknown>[];
    rules?: Record<string, unknown> | Record<string, unknown>[];
    private?: boolean;
    privateCredentialNonce?: string;
    privateSubjectNonce?: string;
  }): SerderACDC {
    const creder = credential({
      issuer: requireHabPrefix(args.registry.hab),
      registry: args.registry.regk ?? "",
      schema: args.schema,
      data: args.data,
      recipient: args.recipient,
      edges: args.edges,
      rules: args.rules,
      private: args.private,
      privateCredentialNonce: args.privateCredentialNonce,
      privateSubjectNonce: args.privateSubjectNonce,
    });
    this.validate(creder);
    return creder;
  }

  validate(creder: SerderACDC): boolean {
    const schema = creder.schema;
    if (typeof schema !== "string") {
      throw new ValidationError("Credential missing schema SAID.");
    }
    const schemer = resolveCachedSchema(this.hby, schema);
    if (!schemer) {
      throw new ValidationError(`Missing schema ${schema}.`);
    }
    return schemer.verify(creder.raw);
  }

  issue(registry: Registry, creder: SerderACDC): CredentialIssueResult {
    const issued = registry.issue(creder);
    const credentialSeal = telEventSeal(issued.serder);
    this.reger.cmse.pin([said(creder), credentialSeal.seqner.qb64], creder);
    const verifierDecision = this.vry.processCredential({
      creder,
      prefixer: credentialSeal.prefixer,
      seqner: credentialSeal.seqner,
      saider: credentialSeal.saider,
    });
    if (verifierDecision.kind === "accept") {
      this.reger.cmse.rem([said(creder), credentialSeal.seqner.qb64]);
      this.reger.ccrd.pin(said(creder), creder);
    }
    return {
      creder,
      tel: issued.serder,
      telDecision: issued.decision,
      verifierDecision,
    };
  }

  complete(credentialSaid: string): boolean {
    return this.reger.ccrd.get(credentialSaid) !== null;
  }

  processCredentialMissingSigEscrow(): void {
    for (const [keys, creder] of [...this.reger.cmse.getTopItemIter()]) {
      const saidKey = keys[0];
      if (!saidKey) {
        continue;
      }
      const anchor = this.reger.cancs.get([saidKey]);
      if (!anchor) {
        continue;
      }
      const [prefixer, number, diger] = anchor;
      const decision = this.vry.processCredential({
        creder,
        prefixer,
        seqner: number,
        saider: diger,
      });
      if (decision.kind === "accept") {
        this.reger.cmse.rem(keys);
        this.reger.ccrd.pin(saidKey, creder);
      }
    }
  }
}

/** Thin holder wallet over KERIpy-compatible verifier indexes. */
export class CredentialWallet {
  readonly reger: Reger;

  constructor(reger: Reger) {
    this.reger = reger;
  }

  getCredentials(schema?: string): Array<[SerderACDC, Prefixer, NumberPrimitive, Diger]> {
    const saids = schema
      ? this.reger.schms.get([schema]).map((saider) => saider.qb64)
      : [...this.reger.creds.getTopItemIter()].map(([keys]) => keys[0]).filter((key): key is string => !!key);
    return saids.map((credentialSaid) => this.reger.cloneCred(credentialSaid));
  }

  list(
    { issued = false, aid, schema }: { issued?: boolean; aid?: string; schema?: string } = {},
  ): string[] {
    const source = issued ? this.reger.issus : this.reger.subjs;
    const candidates = aid
      ? source.get([aid]).map((saider) => saider.qb64)
      : [...source.getTopItemIter()].flatMap(([, saider]) => [saider.qb64]);
    if (!schema) {
      return [...new Set(candidates)];
    }
    const allowed = new Set(this.reger.schms.get([schema]).map((saider) => saider.qb64));
    return [...new Set(candidates)].filter((credentialSaid) => allowed.has(credentialSaid));
  }

  exportCredential(credentialSaid: string): Uint8Array {
    const [creder, prefixer, number, diger] = this.reger.cloneCred(credentialSaid);
    return serializeCredential(creder, prefixer, number, diger);
  }
}
