/**
 * Sally-like verifier agent pipeline.
 *
 * Source of truth:
 * - accepted `/ipex/grant` EXNs in `Baser.exns`
 * - embedded credential/TEL/KEL artifacts in `Baser.epath`
 * - saved credentials and TEL state in `Reger`
 * - TEL revocation cues from the shared runtime cue deck
 *
 * `Notifier` rows are intentionally not consumed here; they remain operator
 * visibility, matching the roadmap contract.
 */

import { Dater, Ilks, Prefixer, SerderACDC, type Versionage, Vrsn_1_0 } from "cesr-ts";
import type { Reger } from "keri-ts/db";
import {
  type AgentCue,
  type CredentialRevokedCue,
  credentialSaidFromGrant,
  Deck,
  type Habery,
  type HttpClient,
  IPEX_GRANT_ROUTE,
  makeNowIso8601,
  processCredentialPresentationArtifacts,
  type ProtocolProcessor,
  storedGrantArtifacts,
  ValidationError,
  type VcStateRecordShape,
} from "keri-ts/runtime";
import { type Operation } from "npm:effection@^3.6.0";
import type { VerifierCueBaser } from "./cue-store.ts";
import { validateCredential, type VerifierBusinessValidator } from "./policy.ts";
import { postWebhook, webhookBody } from "./webhook.ts";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
export interface VerifierAgentProcessResult {
  grantsQueued: number;
  revocationsQueued: number;
  presentationsReady: number;
  revocationsReady: number;
  webhooksSent: number;
  webhooksFailed: number;
  rejected: number;
}

/**
 * Verifier business/webhook settings; stores, intake, HTTP, time and validators are explicit dependencies.
 */
export interface VerifierAgentOptions {
  /** Webhook destination selected by the verifier operator. */
  hook: string;
  /** Attachment genus of grant children, independent of legacy EXN framing. */
  gvrsn?: Versionage;
  /** Local workflow expiry window in milliseconds. */
  timeoutMs?: number;
  /** Require a schema-specific validator before admitting a credential. */
  requireKnownSchemas?: boolean;
}

/** Sally-like verifier processor for one `Habery`/`Reger` runtime. */
export class VerifierAgent {
  /** Borrowed identities and accepted exchange/KEL state. */
  readonly hby: Habery;
  /** Borrowed credential and TEL evidence store used to establish current credential state. */
  readonly reger: Reger;
  /** Verifier workflow store for pending, ready and acknowledged webhook records. */
  readonly cdb: VerifierCueBaser;
  /** Borrowed protocol dispatch and escrow owner; artifact intake owns its own parser and Kevery. */
  readonly protocol: ProtocolProcessor;
  /** Application cue flow; this owner consumes revocation cues and preserves unrelated records. */
  readonly cues: Deck<AgentCue>;
  /** Borrowed scoped HTTP client used for webhook attempts. */
  readonly http: HttpClient;
  /** Borrowed epoch-millisecond source used for webhook timestamps and expiry. */
  readonly now: () => number;
  /** Configured webhook destination, independent of protocol peer routing. */
  readonly hook: string;
  /** Attachment genus used when settling accepted grant artifacts. */
  readonly gvrsn: Versionage;
  /** Existing workflow expiry window; elapsed time is measured by the injected clock. */
  readonly timeoutMs: number;
  /** Schema-specific business checks copied from configuration at construction. */
  readonly validators: Record<string, VerifierBusinessValidator>;
  /** Reject credentials without a configured schema validator when explicitly enabled. */
  readonly requireKnownSchemas: boolean;

  /**
   * Borrow the configured stores, protocol owner and webhook policy; open no runtime or background worker.
   *
   * @param hby Borrowed local identities and accepted-state stores.
   * @param reger Borrowed credential/TEL evidence store.
   * @param cdb Borrowed durable pending/ready/acknowledged webhook store.
   * @param protocol Borrowed shared processor for grant prerequisites and scheduled escrow advancement.
   * @param cues Application cue Deck; only matching revocation cues are consumed.
   * @param http Borrowed HTTP implementation selected by composition.
   * @param now Required epoch-millisecond function, bound to its clock; used for local admission, webhook headers and expiry.
   * @param validators Schema-SAID-to-business-validator table, shallow-copied at construction.
   * @param options Webhook URL, child genus, expiry window (default ten minutes), and known-schema policy.
   */
  constructor(
    hby: Habery,
    reger: Reger,
    cdb: VerifierCueBaser,
    protocol: ProtocolProcessor,
    cues: Deck<AgentCue>,
    http: HttpClient,
    now: () => number,
    validators: Record<string, VerifierBusinessValidator>,
    options: VerifierAgentOptions,
  ) {
    this.hby = hby;
    this.reger = reger;
    this.cdb = cdb;
    this.protocol = protocol;
    this.cues = cues;
    this.http = http;
    this.now = now;
    this.hook = options.hook;
    this.gvrsn = options.gvrsn ?? Vrsn_1_0;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.validators = { ...validators };
    this.requireKnownSchemas = options.requireKnownSchemas ?? false;
  }

  /**
   * Settle verified artifacts and deliver queued webhooks within the caller's operation.
   *
   * @returns Per-pass admission, readiness, webhook and rejection counts; no worker is started.
   */
  *processOnce(): Operation<VerifierAgentProcessResult> {
    const result: VerifierAgentProcessResult = {
      grantsQueued: 0,
      revocationsQueued: 0,
      presentationsReady: 0,
      revocationsReady: 0,
      webhooksSent: 0,
      webhooksFailed: 0,
      rejected: 0,
    };

    // Settle grant evidence and capture revocations before advancing shared protocol dependencies.
    result.grantsQueued += yield* this.scanAcceptedGrants();
    result.revocationsQueued += this.processRevokedCues();
    yield* this.protocol.processEscrowsOnce();
    result.revocationsQueued += this.scanPersistedRevocations();
    // Project accepted evidence into ready work, then observe real webhook delivery outcomes.
    result.presentationsReady += this.processPresentations();
    result.revocationsReady += this.processRevocations();
    result.webhooksSent += yield* this.processReady(this.cdb.recv, "iss", result);
    result.webhooksSent += yield* this.processReady(this.cdb.revk, "rev", result);
    return result;
  }

  /**
   * Settle grant artifacts before queuing their verified credentials for webhook delivery.
   *
   * @returns Number of newly queued presentations after artifact intake and verification.
   */
  private *scanAcceptedGrants(): Operation<number> {
    let queued = 0;
    for (const [, grant] of this.hby.db.exns.getTopItemIter()) {
      if (grant.route !== IPEX_GRANT_ROUTE || !grant.said) {
        continue;
      }
      const credentialSaid = credentialSaidFromGrant(grant);
      if (!credentialSaid || this.hasQueuedOrSent(credentialSaid)) {
        continue;
      }

      const artifacts = storedGrantArtifacts(this.hby, grant, this.gvrsn);
      yield* processCredentialPresentationArtifacts(this.protocol, artifacts);
      const creder = this.reger.creds.get([credentialSaid]);
      if (!creder) {
        throw new ValidationError(`Credential ${credentialSaid} was not saved after grant artifact processing.`);
      }
      const issuer = requireString(creder.issuer, "credential issuer");
      this.cdb.snd.pin([credentialSaid], new Prefixer({ qb64: issuer }));
      this.cdb.iss.pin([credentialSaid], nowDater(this.now()));
      queued += 1;
    }
    return queued;
  }

  /** Consume a finite revocation-cue pass, restoring unrelated and failed records in their original order. */
  private processRevokedCues(): number {
    const retained: AgentCue[] = [];
    const count = this.cues.length;
    let queued = 0;
    try {
      for (let index = 0; index < count; index++) {
        const cue = this.cues.pull();
        if (!cue) break;
        if (cue.kin !== "revoked") retained.push(cue);
        else {
          try {
            queued += this.queueRevocation(cue);
          } catch (error) {
            retained.push(cue);
            throw error;
          }
        }
      }
    } finally {
      for (const cue of retained.reverse()) this.cues.prepend(cue);
    }
    return queued;
  }

  /**
   * Publish existing durable revocation work synchronously; caller retains source ownership through failure.
   *
   * @param cue Accepted credential revocation observation; uses injected local time for workflow admission.
   * @returns One for newly queued work, otherwise zero.
   */
  private queueRevocation(cue: CredentialRevokedCue): number {
    const said = cue.serder.pre;
    if (!said || this.hasRevocationQueuedOrSent(said)) return 0;
    const creder = this.reger.creds.get([said]);
    if (creder?.issuer) this.cdb.snd.pin([said], new Prefixer({ qb64: creder.issuer }));
    this.cdb.rev.pin([said], nowDater(this.now()));
    return 1;
  }

  /**
   * Recover revocation work from saved credentials backed by an accepted IPEX grant.
   *
   * @returns Number of revocations recovered from accepted persisted evidence.
   */
  private scanPersistedRevocations(): number {
    let queued = 0;
    for (const [keys] of this.reger.saved.getTopItemIter()) {
      const said = keys[0];
      if (!said || this.hasRevocationQueuedOrSent(said)) {
        continue;
      }
      const creder = this.reger.creds.get([said]);
      if (!creder || !this.hasAcceptedGrantForCredential(said)) {
        continue;
      }
      const state = credentialState(this.reger, creder);
      if (!state || (state.et !== Ilks.rev && state.et !== Ilks.brv)) {
        continue;
      }
      if (creder.issuer) {
        this.cdb.snd.pin([said], new Prefixer({ qb64: creder.issuer }));
      }
      this.cdb.rev.pin([said], nowDater(this.now()));
      queued += 1;
    }
    return queued;
  }

  /** Move accepted, unexpired and business-valid credentials into the ready presentation store. */
  private processPresentations(): number {
    let ready = 0;
    for (const [keys, dater] of [...this.cdb.iss.getTopItemIter()]) {
      const said = keys[0];
      if (!said) {
        continue;
      }
      if (this.expired(dater)) {
        this.cdb.iss.rem([said]);
        continue;
      }
      if (this.reger.saved.get([said]) === null) {
        continue;
      }
      const creder = this.reger.creds.get([said]);
      if (!creder) {
        continue;
      }
      const state = credentialState(this.reger, creder);
      if (!state) {
        continue;
      }
      if (state.et === Ilks.rev || state.et === Ilks.brv) {
        this.cdb.iss.rem([said]);
        continue;
      }
      const rejection = validateCredential(
        creder,
        this.validators,
        { hby: this.hby, reger: this.reger },
        this.requireKnownSchemas,
      );
      if (rejection) {
        this.cdb.iss.rem([said]);
        continue;
      }
      this.cdb.recv.pin([said, dater.qb64], creder);
      this.cdb.iss.rem([said]);
      ready += 1;
    }
    return ready;
  }

  /** Move confirmed revocations into the ready revocation store, retaining unresolved evidence. */
  private processRevocations(): number {
    let ready = 0;
    for (const [keys, dater] of [...this.cdb.rev.getTopItemIter()]) {
      const said = keys[0];
      if (!said) {
        continue;
      }
      if (this.expired(dater)) {
        this.cdb.rev.rem([said]);
        continue;
      }
      const creder = this.reger.creds.get([said]);
      if (!creder) {
        continue;
      }
      const state = credentialState(this.reger, creder);
      if (!state || state.et === Ilks.iss || state.et === Ilks.bis) {
        continue;
      }
      if (state.et === Ilks.rev || state.et === Ilks.brv) {
        if (creder.issuer) {
          this.cdb.snd.pin([said], new Prefixer({ qb64: creder.issuer }));
        }
        this.cdb.rev.rem([said]);
        this.cdb.revk.pin([said, dater.qb64], creder);
        ready += 1;
      }
    }
    return ready;
  }

  /** Deliver each ready webhook before recording success or applying its expiry policy. */
  private *processReady(
    db: VerifierCueBaser["recv"] | VerifierCueBaser["revk"],
    action: "iss" | "rev",
    result: VerifierAgentProcessResult,
  ): Operation<number> {
    let sent = 0;
    for (const [keys, creder] of [...db.getTopItemIter()]) {
      const [said, daterQb64] = keys;
      if (!said || !daterQb64) {
        continue;
      }

      let state: VcStateRecordShape | null = null;
      if (action === "rev") state = credentialState(this.reger, creder);
      const payload = webhookBody(creder, action, state);
      const accepted = yield* postWebhook(this.http, this.now, this.hook, payload);
      if (accepted) {
        db.rem([said, daterQb64]);
        if (action === "iss") {
          this.cdb.ack.pin([said], creder);
        } else {
          this.cdb.rack.pin([said], creder);
        }
        sent += 1;
        continue;
      }

      result.webhooksFailed += 1;
      const dater = new Dater({ qb64: daterQb64 });
      if (this.expired(dater)) {
        db.rem([said, daterQb64]);
      }
    }
    return sent;
  }

  /** Avoid duplicate presentation work already pending, ready or acknowledged. */
  private hasQueuedOrSent(said: string): boolean {
    return this.cdb.iss.get([said]) !== null
      || this.cdb.ack.get([said]) !== null
      || this.hasReady(this.cdb.recv, said);
  }

  /** Avoid duplicate revocation work already pending, ready or acknowledged. */
  private hasRevocationQueuedOrSent(said: string): boolean {
    return this.cdb.rev.get([said]) !== null
      || this.cdb.rack.get([said]) !== null
      || this.hasReady(this.cdb.revk, said);
  }

  /** Require an accepted grant for this credential before recovering its revocation notification. */
  private hasAcceptedGrantForCredential(said: string): boolean {
    for (const [, grant] of this.hby.db.exns.getTopItemIter()) {
      if (grant.route === IPEX_GRANT_ROUTE && credentialSaidFromGrant(grant) === said) {
        return true;
      }
    }
    return false;
  }

  /** Look up existing ready work by credential without consuming another delivery record. */
  private hasReady(
    db: VerifierCueBaser["recv"] | VerifierCueBaser["revk"],
    said: string,
  ): boolean {
    for (const [keys] of db.getTopItemIter([said, ""])) {
      if (keys[0] === said) {
        return true;
      }
    }
    return false;
  }

  /**
   * Compare workflow age against the injected epoch clock.
   * Ready work is attempted before expiry is checked after refusal. Expiry removes
   * that ready row; it is not a permanent tombstone preventing later rediscovery.
   *
   * @param dater Persisted local workflow admission time encoded as a CESR Dater.
   * @returns True only when elapsed injected wall time is strictly greater than timeoutMs.
   */
  private expired(dater: Dater): boolean {
    return this.now() - new Date(dater.dts).getTime() > this.timeoutMs;
  }
}

/** Read the existing legacy Reger observer state; this application does not interpret native-v2 registries. */
function credentialState(reger: Reger, creder: SerderACDC): VcStateRecordShape | null {
  const regk = creder.regid;
  const said = creder.said;
  if (!regk || !said) {
    return null;
  }
  const tever = reger.tevers.get(regk);
  if (!isRecord(tever) || typeof tever.vcState !== "function") {
    return null;
  }
  return (tever.vcState as (vcid: string) => VcStateRecordShape | null)(said);
}

/**
 * Encode a local workflow timestamp from the same epoch-millisecond source used for expiry.
 *
 * @param now Local epoch milliseconds from the injected verifier clock.
 * @returns CESR Dater used for durable workflow admission, not the signed protocol timestamp.
 */
function nowDater(now: number): Dater {
  return new Dater({ dts: makeNowIso8601(new Date(now)) });
}

/** Refuse absent signed identifiers before writing workflow coordinates. */
function requireString(value: string | null, label: string): string {
  if (!value) {
    throw new ValidationError(`Missing ${label}.`);
  }
  return value;
}

/** Narrow structural provider/attribute data at the public protocol boundary. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
