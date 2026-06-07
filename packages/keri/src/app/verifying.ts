/**
 * Registry-backed ACDC verifier.
 *
 * KERIpy correspondence:
 * - ports `keri.vdr.verifying.Verifier` credential save, chain verification,
 *   missing registry/schema/chain escrows, and verifier cue policy
 *
 * TypeScript divergence:
 * - ordinary outcomes are explicit decisions instead of exception-only control
 *   flow; durable corruption and unsupported `DI2I` still fail explicitly
 */
import { Dater, Diger, Ilks, NumberPrimitive, Prefixer, Saider, SerderACDC } from "../../../cesr/mod.ts";
import type { AgentCue } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { ValidationError } from "../core/errors.ts";
import type { VcStateRecordShape } from "../core/records.ts";
import type { Reger } from "../db/reger.ts";
import { encodeDateTimeToDater, makeNowIso8601 } from "../time/mod.ts";
import type { Habery } from "./habbing.ts";
import type { AcdcDispatchArgs } from "./parsering.ts";
import { resolveCachedSchema } from "./schema-resolving.ts";

export type VerifierEscrowReason = "missingRegistry" | "missingSchema" | "missingChain";
export type VerifierRejectReason =
  | "missingAnchor"
  | "invalidCredential"
  | "invalidSchema"
  | "invalidEdge"
  | "revokedChain"
  | "unsupportedChainOperator";

export type VerifierDecision =
  | { kind: "accept"; said: string }
  | { kind: "escrow"; reason: VerifierEscrowReason; said: string }
  | { kind: "reject"; reason: VerifierRejectReason; said: string; detail?: string };

export type VerifierCue = Extract<
  AgentCue,
  { kin: "telquery" | "query" | "proof" | "saved" }
>;

export interface CredentialStateProvider {
  vcState(vcid: string): VcStateRecordShape | null | undefined;
}

export interface VerifierOptions {
  reger: Reger;
  cues?: Deck<AgentCue>;
  credentialExpiryMs?: number;
  missingRegistryTimeoutMs?: number;
  missingIssuerTimeoutMs?: number;
}

/**
 * Concrete verifier service consumed by `Reactor` through `VerifierLike`.
 *
 * The verifier owns only credential validation/indexing and its own VDR escrows.
 * TEL processing remains delegated to `Tevery`, and webhook/application policy
 * belongs above this class.
 */
export class Verifier {
  static readonly DefaultCredentialExpiryMs = 36_000_000_000_000;
  static readonly DefaultMissingRegistryTimeoutMs = 3_600_000;
  static readonly DefaultMissingIssuerTimeoutMs = 3_600_000;

  readonly hby: Habery;
  readonly reger: Reger;
  readonly cues: Deck<AgentCue>;
  readonly credentialExpiryMs: number;
  readonly missingRegistryTimeoutMs: number;
  readonly missingIssuerTimeoutMs: number;

  constructor(hby: Habery, options: VerifierOptions) {
    this.hby = hby;
    this.reger = options.reger;
    this.cues = options.cues ?? new Deck<AgentCue>();
    this.credentialExpiryMs = options.credentialExpiryMs ?? Verifier.DefaultCredentialExpiryMs;
    this.missingRegistryTimeoutMs = options.missingRegistryTimeoutMs ?? Verifier.DefaultMissingRegistryTimeoutMs;
    this.missingIssuerTimeoutMs = options.missingIssuerTimeoutMs ?? Verifier.DefaultMissingIssuerTimeoutMs;
  }

  /** KERIpy-style registry state machine map. */
  get tevers(): Map<string, unknown> {
    return this.reger.tevers;
  }

  /** Parser-compatible ACDC handoff. */
  processACDC(args: AcdcDispatchArgs): VerifierDecision {
    if (!args.prefixer || !args.seqner || !args.saider) {
      return {
        kind: "reject",
        reason: "missingAnchor",
        said: args.serder.said ?? "<unknown>",
        detail: "ACDC dispatch is missing a source seal triple.",
      };
    }
    return this.processCredential({
      creder: args.serder,
      prefixer: args.prefixer,
      seqner: args.seqner,
      saider: args.saider,
    });
  }

  /** Validate and save one registry-backed credential. */
  processCredential(args: {
    creder: SerderACDC;
    prefixer: Prefixer;
    seqner: NumberPrimitive;
    saider: Diger;
  }): VerifierDecision {
    const creder = args.creder;
    const said = credentialSaid(creder);
    const regk = creder.regid;
    const issuer = creder.issuer;
    const schema = creder.schema;
    if (!regk || !issuer || typeof schema !== "string") {
      return {
        kind: "reject",
        reason: "invalidCredential",
        said,
        detail: "Credential is missing registry, issuer, or schema SAID.",
      };
    }

    const tever = teverFrom(this.tevers.get(regk));
    if (!tever) {
      if (this.escrowMRE(args)) {
        this.cues.push({ kin: "telquery", q: { ri: regk, i: said, issr: issuer } });
      }
      return { kind: "escrow", reason: "missingRegistry", said };
    }

    const state = tever.vcState(said) ?? null;
    if (!state) {
      if (this.escrowMRE(args)) {
        this.cues.push({ kin: "telquery", q: { ri: regk, i: said } });
      }
      return { kind: "escrow", reason: "missingRegistry", said };
    }

    if (this.isCredentialStateStale(state)) {
      if (this.escrowMRE(args)) {
        this.cues.push({ kin: "telquery", q: { ri: regk, i: said } });
      }
      return { kind: "escrow", reason: "missingRegistry", said };
    }

    const schemer = resolveCachedSchema(this.hby, schema);
    if (!schemer) {
      if (this.escrowMSE(args)) {
        this.cues.push({ kin: "query", q: { r: "schema", said: schema } });
      }
      return { kind: "escrow", reason: "missingSchema", said };
    }

    try {
      schemer.verify(creder.raw);
    } catch (error) {
      return {
        kind: "reject",
        reason: "invalidSchema",
        said,
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    const edges = normalizedEdges(creder.edge);
    if (!edges) {
      return {
        kind: "reject",
        reason: "invalidEdge",
        said,
        detail: "Credential edge section must be an object or list of objects.",
      };
    }

    for (const edge of edges) {
      for (const [label, node] of Object.entries(edge)) {
        if (label === "d" || label === "o") {
          continue;
        }
        if (!isRecord(node) || typeof node.n !== "string") {
          return {
            kind: "reject",
            reason: "invalidEdge",
            said,
            detail: `Credential edge ${label} is missing node SAID.`,
          };
        }
        const op = typeof node.o === "string" ? node.o : undefined;
        let chainState: VcStateRecordShape | null;
        try {
          chainState = this.verifyChain(node.n, op, issuer);
        } catch (error) {
          return {
            kind: "reject",
            reason: "unsupportedChainOperator",
            said,
            detail: error instanceof Error ? error.message : String(error),
          };
        }
        if (!chainState) {
          this.escrowMCE(args);
          this.cues.push({ kin: "proof", said: node.n });
          return { kind: "escrow", reason: "missingChain", said };
        }
        if (this.isCredentialStateStale(chainState)) {
          this.escrowMCE(args);
          this.cues.push({ kin: "query", q: { r: "tels", pre: node.n } });
          return { kind: "escrow", reason: "missingChain", said };
        }
        if (chainState.et === Ilks.rev || chainState.et === Ilks.brv) {
          return {
            kind: "reject",
            reason: "revokedChain",
            said,
            detail: `Credential chain ${label}(${node.n}) is revoked.`,
          };
        }
      }
    }

    this.saveCredential(args);
    this.cues.push({ kin: "saved", creder });
    return { kind: "accept", said };
  }

  /** Missing registry escrow. */
  escrowMRE(args: {
    creder: SerderACDC;
    prefixer: Prefixer;
    seqner: NumberPrimitive;
    saider: Diger;
  }): boolean {
    this.reger.logCred(args.creder, args.prefixer, args.seqner, args.saider);
    return this.reger.mre.put([credentialSaid(args.creder)], nowDater());
  }

  /** Missing chain escrow. */
  escrowMCE(args: {
    creder: SerderACDC;
    prefixer: Prefixer;
    seqner: NumberPrimitive;
    saider: Diger;
  }): boolean {
    this.reger.logCred(args.creder, args.prefixer, args.seqner, args.saider);
    return this.reger.mce.put([credentialSaid(args.creder)], nowDater());
  }

  /** Missing schema escrow. */
  escrowMSE(args: {
    creder: SerderACDC;
    prefixer: Prefixer;
    seqner: NumberPrimitive;
    saider: Diger;
  }): boolean {
    this.reger.logCred(args.creder, args.prefixer, args.seqner, args.saider);
    return this.reger.mse.put([credentialSaid(args.creder)], nowDater());
  }

  /** Replay verifier escrows in KERIpy order: missing chain, schema, registry. */
  processEscrows(): void {
    this.processEscrow(this.reger.mce, "missingChain", this.missingIssuerTimeoutMs);
    this.processEscrow(this.reger.mse, "missingSchema", this.missingIssuerTimeoutMs);
    this.processEscrow(this.reger.mre, "missingRegistry", this.missingRegistryTimeoutMs);
  }

  /** Save a fully processed credential and KERIpy-compatible indexes. */
  saveCredential(args: {
    creder: SerderACDC;
    prefixer: Prefixer;
    seqner: NumberPrimitive;
    saider: Diger;
  }): void {
    const said = credentialSaid(args.creder);
    const issuer = args.creder.issuer;
    const schema = args.creder.schema;
    if (!issuer || typeof schema !== "string") {
      throw new ValidationError("Cannot save credential without issuer and schema.");
    }

    this.reger.logCred(args.creder, args.prefixer, args.seqner, args.saider);
    const saider = new Saider({ qb64: said });
    this.reger.saved.pin([said], saider);
    this.reger.issus.add([issuer], saider);
    this.reger.schms.add([schema], saider);
    const attrib = args.creder.attrib;
    if (isRecord(attrib) && typeof attrib.i === "string") {
      this.reger.subjs.add([attrib.i], saider);
    }
  }

  /** Verify the credential at the far end of an edge. */
  verifyChain(nodeSaid: string, op: string | undefined, issuer: string): VcStateRecordShape | null {
    if (this.reger.saved.get([nodeSaid]) === null) {
      return null;
    }
    const creder = this.reger.creds.get([nodeSaid]);
    if (!creder) {
      return null;
    }
    const attrib = creder.attrib;
    let operator = op;
    if (operator !== "I2I" && operator !== "DI2I" && operator !== "NI2I") {
      operator = isRecord(attrib) && typeof attrib.i === "string" ? "I2I" : "NI2I";
    }

    if (operator !== "NI2I") {
      if (!isRecord(attrib) || typeof attrib.i !== "string") {
        return null;
      }
      if (this.reger.subjs.get([attrib.i]).length === 0) {
        return null;
      }
      if (operator === "I2I" && issuer !== attrib.i) {
        return null;
      }
      if (operator === "DI2I") {
        throw new ValidationError("DI2I credential chain verification is not implemented.");
      }
    }

    const regk = creder.regid;
    const tever = regk ? teverFrom(this.tevers.get(regk)) : null;
    return tever?.vcState(nodeSaid) ?? null;
  }

  private processEscrow(
    db: { getTopItemIter(): Iterable<[string[], Dater]>; rem(keys: string[]): boolean },
    expectedReason: VerifierEscrowReason,
    timeoutMs: number,
  ): void {
    for (const [keys, dater] of db.getTopItemIter()) {
      const said = keys[0];
      if (!said) {
        continue;
      }
      if (Date.now() - new Date(dater.iso8601).getTime() > timeoutMs) {
        db.rem([said]);
        continue;
      }
      const [creder, prefixer, seqner, saider] = this.reger.cloneCred(said);
      let decision: VerifierDecision;
      try {
        decision = this.processCredential({ creder, prefixer, seqner, saider });
      } catch {
        db.rem([said]);
        continue;
      }
      if (decision.kind === "accept" || decision.kind === "reject") {
        db.rem([said]);
        continue;
      }
      if (decision.reason !== expectedReason) {
        db.rem([said]);
      }
    }
  }

  private isCredentialStateStale(state: VcStateRecordShape): boolean {
    if (!state.dt) {
      return false;
    }
    const dt = parseIso8601Millis(state.dt);
    return dt !== null && Date.now() - dt > this.credentialExpiryMs;
  }
}

function credentialSaid(creder: SerderACDC): string {
  if (!creder.said) {
    throw new ValidationError("Credential is missing SAID.");
  }
  return creder.said;
}

function teverFrom(value: unknown): CredentialStateProvider | null {
  if (isRecord(value) && typeof value.vcState === "function") {
    return value as unknown as CredentialStateProvider;
  }
  return null;
}

function normalizedEdges(edge: unknown): Record<string, unknown>[] | null {
  if (edge === null || edge === undefined) {
    return [{}];
  }
  if (Array.isArray(edge)) {
    return edge.every(isRecord) ? edge : null;
  }
  return isRecord(edge) ? [edge] : null;
}

function nowDater(): Dater {
  return new Dater({ qb64: encodeDateTimeToDater(makeNowIso8601()) });
}

function parseIso8601Millis(value: string): number | null {
  const normalized = value.replace(/\.(\d{3})\d+/, ".$1");
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
