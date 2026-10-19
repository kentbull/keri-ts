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
import { call, type Operation } from "npm:effection@^3.6.0";
import type { AgentCue, CredentialRevokedCue } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { ValidationError } from "../core/errors.ts";
import type { VcStateRecordShape } from "../core/records.ts";
import type { Reger } from "../db/reger.ts";
import type { VerifierCueBaser } from "../db/verifier-cueing.ts";
import { encodeDateTimeToDater, makeNowIso8601 } from "../time/mod.ts";
import type { Habery } from "./habbing.ts";
import type { HttpClient } from "./http-client.ts";
import {
  credentialSaidFromGrant,
  processCredentialPresentationArtifacts,
  storedGrantArtifacts,
} from "./ipex-credentialing.ts";
import { IPEX_GRANT_ROUTE } from "./ipexing.ts";
import type { Reactor } from "./reactor.ts";

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

export interface VerifierWebhookBody {
  action: "iss" | "rev";
  actor: string;
  data: Record<string, unknown>;
}

export interface VerifierBusinessValidatorContext {
  hby: Habery;
  reger: Reger;
}

export type VerifierBusinessValidator = (
  creder: SerderACDC,
  context: VerifierBusinessValidatorContext,
) => boolean | string | void;

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
  /** Borrowed input owner whose shared protocol processor advances credential prerequisites. */
  readonly reactor: Reactor;
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

  /** Borrow the configured stores, input owner and webhook policy; open no runtime or background worker. */
  constructor(
    hby: Habery,
    reger: Reger,
    cdb: VerifierCueBaser,
    reactor: Reactor,
    cues: Deck<AgentCue>,
    http: HttpClient,
    now: () => number,
    validators: Record<string, VerifierBusinessValidator>,
    options: VerifierAgentOptions,
  ) {
    this.hby = hby;
    this.reger = reger;
    this.cdb = cdb;
    this.reactor = reactor;
    this.cues = cues;
    this.http = http;
    this.now = now;
    this.hook = options.hook;
    this.gvrsn = options.gvrsn ?? Vrsn_1_0;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.validators = { ...validators };
    this.requireKnownSchemas = options.requireKnownSchemas ?? false;
  }

  /** Settle verified artifacts and deliver queued webhooks within the caller's operation. */
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
    yield* this.reactor.protocol.processEscrowsOnce();
    result.revocationsQueued += this.scanPersistedRevocations();
    // Project accepted evidence into ready work, then observe real webhook delivery outcomes.
    result.presentationsReady += this.processPresentations();
    result.revocationsReady += this.processRevocations();
    result.webhooksSent += yield* this.processReady(this.cdb.recv, "iss", result);
    result.webhooksSent += yield* this.processReady(this.cdb.revk, "rev", result);
    return result;
  }

  /** Settle grant artifacts before queuing their verified credentials for webhook delivery. */
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
      yield* processCredentialPresentationArtifacts(this.reactor, artifacts);
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

  /** Publish existing durable revocation work synchronously; caller retains source ownership through failure. */
  private queueRevocation(cue: CredentialRevokedCue): number {
    const said = cue.serder.pre;
    if (!said || this.hasRevocationQueuedOrSent(said)) return 0;
    const creder = this.reger.creds.get([said]);
    if (creder?.issuer) this.cdb.snd.pin([said], new Prefixer({ qb64: creder.issuer }));
    this.cdb.rev.pin([said], nowDater(this.now()));
    return 1;
  }

  /** Recover revocation work from saved credentials backed by an accepted IPEX grant. */
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
      const rejection = this.validateCredential(creder);
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

      const payload = webhookBody(this.reger, creder, action);
      const accepted = yield* this.postWebhook(payload);
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

  /** Bind webhook transport cancellation and completion to the enclosing operation. */
  private *postWebhook(body: VerifierWebhookBody): Operation<boolean> {
    const raw = JSON.stringify(body);
    const http = this.http, now = this.now, hook = this.hook;
    return yield* call(function*() {
      const response = yield* http.open(hook, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sally-resource": String(body.data.schema ?? ""),
          "sally-timestamp": new Date(now()).toISOString(),
        },
        body: raw,
      });
      // Returning from this call scope closes the unread response before publishing success.
      return response.ok;
    });
  }

  /** Apply the configured business validator; return a refusal reason without changing protocol evidence. */
  private validateCredential(creder: SerderACDC): string | null {
    const schema = schemaOf(creder);
    if (!schema) {
      return "missing credential schema";
    }
    const validator = this.validators[schema];
    if (!validator) {
      return this.requireKnownSchemas ? `unsupported credential schema ${schema}` : null;
    }
    const result = validator(creder, { hby: this.hby, reger: this.reger });
    if (typeof result === "string") {
      return result;
    }
    return result === false ? `credential ${creder.said ?? "<unknown>"} failed business validation` : null;
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

  /** Compare a workflow timestamp with the injected clock and configured expiry window. */
  private expired(dater: Dater): boolean {
    return this.now() - new Date(dater.dts).getTime() > this.timeoutMs;
  }
}

/** Build validators from a local JSON config object. */
export function validatorsFromVerifierConfig(
  config: unknown,
): Record<string, VerifierBusinessValidator> {
  if (!isRecord(config) || !isRecord(config.schemas)) {
    return {};
  }
  const validators: Record<string, VerifierBusinessValidator> = {};
  for (const [schema, policy] of Object.entries(config.schemas)) {
    if (!isRecord(policy)) {
      continue;
    }
    validators[schema] = (creder) => {
      const issuer = typeof policy.issuer === "string" ? policy.issuer : "";
      if (issuer && creder.issuer !== issuer) {
        return `expected issuer ${issuer}, got ${creder.issuer ?? "<missing>"}`;
      }
      return true;
    };
  }
  return validators;
}

function webhookBody(
  reger: Reger,
  creder: SerderACDC,
  action: "iss" | "rev",
): VerifierWebhookBody {
  const actor = creder.issuer ?? "";
  const data = action === "iss" ? presentationPayload(creder) : revocationPayload(reger, creder);
  return { action, actor, data };
}

function presentationPayload(creder: SerderACDC): Record<string, unknown> {
  const attrs = isRecord(creder.attrib) ? creder.attrib : {};
  return {
    schema: schemaOf(creder),
    issuer: creder.issuer,
    issueTimestamp: typeof attrs.dt === "string" ? attrs.dt : undefined,
    credential: creder.said,
    recipient: typeof attrs.i === "string" ? attrs.i : undefined,
    attributes: attrs,
    edge: creder.edge ?? undefined,
  };
}

function revocationPayload(reger: Reger, creder: SerderACDC): Record<string, unknown> {
  const state = credentialState(reger, creder);
  return {
    schema: schemaOf(creder),
    credential: creder.said,
    revocationTimestamp: state?.dt,
  };
}

function schemaOf(creder: SerderACDC): string {
  return typeof creder.schema === "string" ? creder.schema : "";
}

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

/** Encode a local workflow timestamp from the same epoch-millisecond source used for expiry. */
function nowDater(now: number): Dater {
  return new Dater({ qb64: encodeDateTimeToDater(makeNowIso8601(new Date(now))) });
}

function requireString(value: string | null, label: string): string {
  if (!value) {
    throw new ValidationError(`Missing ${label}.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
