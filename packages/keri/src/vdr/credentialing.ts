/**
 * Registry-backed credential issuance orchestration.
 *
 * KERIpy correspondence:
 * - mirrors the single-sig portions of `keri.vdr.credentialing`
 * - keeps registry/TEL ownership in `Reger` + `Tevery`
 * - keeps credential validation/save ownership in `Verifier`
 *
 * Current boundary:
 * - TelPublication owns durable anchor/receipt/publication progression; the
 *   application host owns actual receipt collection and network dissemination.
 */
import {
  concatBytes,
  DigDex,
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
  Vrsn_1_0,
} from "cesr-ts";
import type { Hab, Habery } from "../app/habbing.ts";
import { resolveCachedSchema } from "../app/schema-resolving.ts";
import { Verifier, type VerifierDecision } from "../app/verifying.ts";
import { attachmentCounterPayloadQb64b, resolveAttachmentGvrsn } from "../core/attachment-countering.ts";
import type { AgentCue } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { DatabaseOperationError, ValidationError } from "../core/errors.ts";
import {
  incept as inceptRegistryEvent,
  issue as issueEvent,
} from "../core/protocol-vdr-eventing.ts";
import { RegistryRecord } from "../core/records.ts";
import { dgKey } from "../db/core/keys.ts";
import type { Reger } from "../db/reger.ts";
import { makeNowIso8601 } from "../time/mod.ts";
import { type TelProcessDecision, Tevery } from "./eventing.ts";
import { prepareCredentialRevocation } from "./revoking.ts";
import { telAnchorMatches } from "./tel-anchor.ts";
import { TelPublication } from "./tel-publication.ts";

export interface RegeryOptions {
  reger: Reger;
  tvy?: Tevery;
  vry?: Verifier;
  cues?: Deck<AgentCue>;
}

export interface RegistryOptions {
  publication: TelPublication;
  name: string;
  hab: Hab;
  reger: Reger;
  tvy: Tevery;
  cues?: Deck<AgentCue>;
  regk?: string;
  estOnly?: boolean;
}

export interface RegistryInceptOptions {
  estOnly?: boolean;
  nonce?: string;
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

/** Encode an ordinal value as the fixed-width v1 seal primitive. */
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

/** Anchor under the registry or issuer establishment policy; callers retain the resulting exact coordinate. */
function anchorTelEvent(hab: Hab, serder: SerderKERI, estOnly: boolean): AnchorSeal {
  if (!serder.pre || !serder.snh || !serder.said) {
    throw new ValidationError("TEL event missing seal fields.");
  }
  const data = [{ i: serder.pre, s: serder.snh, d: serder.said }];
  if (estOnly || hab.kever?.estOnly) hab.rotate({ data });
  else hab.interact({ data });
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
  privateSubjectNonce?: string,
): Record<string, unknown> | string {
  if (typeof data === "string") {
    return data;
  }
  const attrs: Record<string, unknown> = { d: "" };
  if (privateSubjectNonce) {
    attrs.u = privateSubjectNonce;
  }
  if (recipient) {
    attrs.i = recipient;
  }
  attrs.dt = dt ?? (typeof data?.dt === "string" ? data.dt : makeNowIso8601());
  Object.assign(attrs, data ?? {});
  return attrs;
}

function saidifySubject(
  data: Record<string, unknown> | string,
  kind: Kind,
): Record<string, unknown> | string {
  if (typeof data === "string") {
    return data;
  }
  return Saider.saidify(data, {
    kind,
    label: "d",
    code: DigDex.Blake3_256,
  }).sad;
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
    a: saidifySubject(
      subjectAttributes(
        data,
        recipient,
        dt,
        privateSubjectNonce ?? (privateCredential ? crypto.randomUUID() : undefined),
      ),
      kind,
    ),
  };
  if (privateCredential || privateCredentialNonce) {
    sad.u = privateCredentialNonce ?? crypto.randomUUID();
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

/** Preserve one ACDC body and encode its source triple at the body/requested genus floor. */
export function serializeCredential(
  creder: SerderACDC,
  prefixer: Prefixer,
  number: NumberPrimitive | Seqner,
  saider: Diger,
  gvrsn: Versionage = Vrsn_1_0,
): Uint8Array {
  gvrsn = resolveAttachmentGvrsn(creder, gvrsn);
  // V1 requires a fixed-width Seqner; v2 accepts the stored qualified Number unchanged.
  const ordinal = gvrsn.major === 1 && !(number instanceof Seqner) ? seqner(number.num) : number;
  const sealPayload = [
    prefixer.qb64b,
    ordinal.qb64b,
    saider.qb64b,
  ];
  return concatBytes(
    creder.raw,
    attachmentCounterPayloadQb64b(
      "SealSourceTriples",
      1,
      sealPayload,
      gvrsn,
    ),
    ...sealPayload,
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
  readonly publication: TelPublication;

  constructor(hby: Habery, options: RegeryOptions) {
    this.hby = hby;
    this.reger = options.reger;
    this.publication = new TelPublication(hby.db, this.reger);
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
          publication: this.publication,
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
      publication: this.publication,
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
    this.publication.advance();
  }
}

/** Local NoBackers registry authoring; externally backed state remains available for observation. */
export class Registry {
  readonly publication: TelPublication;
  readonly name: string;
  readonly hab: Hab;
  readonly reger: Reger;
  readonly tvy: Tevery;
  readonly cues: Deck<AgentCue>;
  regk: string | null;
  estOnly: boolean;

  constructor(options: RegistryOptions) {
    if (options.publication.db !== options.hab.db || options.publication.reger !== options.reger) {
      throw new TypeError("Registry publication must use its issuer KEL and TEL stores.");
    }
    this.publication = options.publication;
    this.name = options.name;
    this.hab = options.hab;
    this.reger = options.reger;
    this.tvy = options.tvy;
    this.cues = options.cues ?? new Deck<AgentCue>();
    this.regk = options.regk ?? null;
    const config = this.regk ? this.reger.states.get(this.regk)?.c ?? [] : [];
    this.estOnly = options.estOnly ?? config.includes(TraitDex.EstOnly);
  }

  incept(options: RegistryInceptOptions = {}): TelProcessDecision {
    const cnfg = [
      TraitDex.NoBackers,
      ...(options.estOnly ? [TraitDex.EstOnly] : []),
    ];
    const serder = inceptRegistryEvent(requireHabPrefix(this.hab), {
      cnfg,
      nonce: options.nonce,
    });
    const seal = anchorTelEvent(this.hab, serder, options.estOnly ?? this.estOnly);
    const decision = this.tvy.processEvent({ serder, seqner: seal.seqner, saider: seal.saider });
    if (decision.kind !== "accept") {
      throw new ValidationError(`Registry inception failed: ${decision.kind}`);
    }
    this.regk = said(serder);
    this.estOnly = cnfg.includes(TraitDex.EstOnly);
    this.reger.registries.add(this.regk);
    this.reger.regs.pin(
      this.name,
      new RegistryRecord({
        registryKey: this.regk,
        prefix: requireHabPrefix(this.hab),
      }),
    );
    this.trackPublication(serder, seal);
    return decision;
  }

  issue(creder: SerderACDC): { serder: SerderKERI; decision: TelProcessDecision; seal: AnchorSeal } {
    this.authoringState();
    const regk = this.requireRegk();
    const serder = issueEvent(said(creder), regk);
    const seal = anchorTelEvent(this.hab, serder, this.estOnly);
    const decision = this.tvy.processEvent({ serder, seqner: seal.seqner, saider: seal.saider });
    this.trackPublication(serder, seal);
    return { serder, decision, seal };
  }

  /** Select the original REV or prepare one after read-only credential/registry authority checks. */
  prepareRevocation(credentialSaid: string): SerderKERI {
    this.authoringState();
    return prepareCredentialRevocation(this.reger, requireHabPrefix(this.hab), this.requireRegk(), credentialSaid);
  }

  /** Revoke once; explicit retries reuse the retained TEL body and original issuer anchor. */
  revoke(
    credentialSaid: string,
  ): { serder: SerderKERI; decision: TelProcessDecision; seal: AnchorSeal } {
    const serder = this.prepareRevocation(credentialSaid);
    const couple = this.reger.ancs.get(dgKey(credentialSaid, serder.said!));
    let seal: AnchorSeal;
    if (couple) {
      const anchor = this.hab.db.getEvtSerder(requireHabPrefix(this.hab), couple[1].qb64);
      if (!anchor || anchor.sner?.num !== couple[0].num || !telAnchorMatches(this.hab.pre, serder, anchor)) {
        throw new DatabaseOperationError("Stored revocation issuer anchor is missing or inconsistent.");
      }
      seal = { prefixer: new Prefixer({ qb64: this.hab.pre }), seqner: couple[0], saider: couple[1] };
    } else {
      seal = anchorTelEvent(this.hab, serder, this.estOnly);
    }
    const decision = this.tvy.processEvent({ serder, seqner: seal.seqner, saider: seal.saider });
    this.trackPublication(serder, seal);
    return { serder, decision, seal };
  }

  complete(pre: string, sn = 0): boolean {
    return this.publication.complete(pre, sn);
  }

  /** Keep publication progress with the original accepted issuer anchor. */
  private trackPublication(event: SerderKERI, seal: AnchorSeal): void {
    const anchor = this.hab.db.getEvtSerder(requireHabPrefix(this.hab), seal.saider.qb64);
    if (!anchor) throw new ValidationError("Missing locally authored TEL anchor.");
    this.publication.track(event, anchor);
  }

  private requireRegk(): string {
    if (!this.regk) {
      throw new ValidationError(`Registry ${this.name} has not been incepted.`);
    }
    return this.regk;
  }

  /** Foreign backed registries remain readable, but cannot authorize local TEL authoring. */
  private authoringState() {
    const tever = this.tvy.tevers.get(this.requireRegk());
    if (!tever) {
      throw new ValidationError(`Missing TEL state for registry ${this.requireRegk()}.`);
    }
    if (!tever.noBackers) {
      throw new ValidationError("Local credential authoring requires a NoBackers registry.");
    }
    return tever;
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
