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
import { concatBytes, Counter, Dater, Ilks, parsePather, Prefixer, SerderACDC, SerderKERI } from "../../../cesr/mod.ts";
import type { AgentCue } from "../core/cues.ts";
import type { Deck } from "../core/deck.ts";
import { ValidationError } from "../core/errors.ts";
import type { VcStateRecordShape } from "../core/records.ts";
import type { Reger } from "../db/reger.ts";
import type { VerifierCueBaser } from "../db/verifier-cueing.ts";
import { encodeDateTimeToDater, makeNowIso8601 } from "../time/mod.ts";
import type { Habery } from "./habbing.ts";
import { type CredentialPresentationArtifacts, processCredentialPresentationArtifacts } from "./ipex-credentialing.ts";
import { IPEX_GRANT_ROUTE } from "./ipexing.ts";
import type { Reactor } from "./reactor.ts";
import type { RuntimeServices } from "./runtime-services.ts";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const textEncoder = new TextEncoder();

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
  hby: Habery;
  reger: Reger;
  cdb: VerifierCueBaser;
  reactor: Reactor;
  cues: Deck<AgentCue>;
  services: RuntimeServices;
  hook: string;
  timeoutMs?: number;
  validators?: Record<string, VerifierBusinessValidator>;
  requireKnownSchemas?: boolean;
}

/** Sally-like verifier processor for one `Habery`/`Reger` runtime. */
export class VerifierAgent {
  readonly hby: Habery;
  readonly reger: Reger;
  readonly cdb: VerifierCueBaser;
  readonly reactor: Reactor;
  readonly cues: Deck<AgentCue>;
  readonly services: RuntimeServices;
  readonly hook: string;
  readonly timeoutMs: number;
  readonly validators: Record<string, VerifierBusinessValidator>;
  readonly requireKnownSchemas: boolean;

  constructor(options: VerifierAgentOptions) {
    this.hby = options.hby;
    this.reger = options.reger;
    this.cdb = options.cdb;
    this.reactor = options.reactor;
    this.cues = options.cues;
    this.services = options.services;
    this.hook = options.hook;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.validators = { ...(options.validators ?? {}) };
    this.requireKnownSchemas = options.requireKnownSchemas ?? false;
  }

  async processOnce(): Promise<VerifierAgentProcessResult> {
    const result: VerifierAgentProcessResult = {
      grantsQueued: 0,
      revocationsQueued: 0,
      presentationsReady: 0,
      revocationsReady: 0,
      webhooksSent: 0,
      webhooksFailed: 0,
      rejected: 0,
    };

    result.grantsQueued += this.scanAcceptedGrants();
    result.revocationsQueued += this.processRevokedCues();
    this.reactor.processEscrowsOnce();
    result.revocationsQueued += this.scanPersistedRevocations();
    result.presentationsReady += this.processPresentations();
    result.revocationsReady += this.processRevocations();
    result.webhooksSent += await this.processReady(this.cdb.recv, "iss", result);
    result.webhooksSent += await this.processReady(this.cdb.revk, "rev", result);
    return result;
  }

  private scanAcceptedGrants(): number {
    let queued = 0;
    for (const [, grant] of this.hby.db.exns.getTopItemIter()) {
      if (grant.route !== IPEX_GRANT_ROUTE || !grant.said) {
        continue;
      }
      const credentialSaid = credentialSaidFromGrant(grant);
      if (!credentialSaid || this.hasQueuedOrSent(credentialSaid)) {
        continue;
      }

      const artifacts = storedGrantArtifacts(this.hby, grant);
      processCredentialPresentationArtifacts(this.reactor, artifacts);
      const creder = this.reger.creds.get([credentialSaid]);
      if (!creder) {
        throw new ValidationError(`Credential ${credentialSaid} was not saved after grant artifact processing.`);
      }
      const issuer = requireString(creder.issuer, "credential issuer");
      this.cdb.snd.pin([credentialSaid], new Prefixer({ qb64: issuer }));
      this.cdb.iss.pin([credentialSaid], nowDater());
      queued += 1;
    }
    return queued;
  }

  private processRevokedCues(): number {
    const retained: AgentCue[] = [];
    let queued = 0;
    while (!this.cues.empty) {
      const cue = this.cues.pull();
      if (!cue) {
        continue;
      }
      if (cue.kin !== "revoked") {
        retained.push(cue);
        continue;
      }
      const said = cue.serder.pre;
      if (!said || this.hasRevocationQueuedOrSent(said)) {
        continue;
      }
      const creder = this.reger.creds.get([said]);
      if (creder?.issuer) {
        this.cdb.snd.pin([said], new Prefixer({ qb64: creder.issuer }));
      }
      this.cdb.rev.pin([said], nowDater());
      queued += 1;
    }
    this.cues.extend(retained);
    return queued;
  }

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
      this.cdb.rev.pin([said], nowDater());
      queued += 1;
    }
    return queued;
  }

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

  private async processReady(
    db: VerifierCueBaser["recv"] | VerifierCueBaser["revk"],
    action: "iss" | "rev",
    result: VerifierAgentProcessResult,
  ): Promise<number> {
    let sent = 0;
    for (const [keys, creder] of [...db.getTopItemIter()]) {
      const [said, daterQb64] = keys;
      if (!said || !daterQb64) {
        continue;
      }

      const payload = webhookBody(this.reger, creder, action);
      const response = await this.postWebhook(payload);
      if (response.ok) {
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

  private async postWebhook(body: VerifierWebhookBody): Promise<Response> {
    const raw = JSON.stringify(body);
    return await this.services.http.fetch(this.hook, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sally-resource": String(body.data.schema ?? ""),
        "sally-timestamp": new Date(this.services.clock.now()).toISOString(),
      },
      body: raw,
    });
  }

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

  private hasQueuedOrSent(said: string): boolean {
    return this.cdb.iss.get([said]) !== null ||
      this.cdb.ack.get([said]) !== null ||
      this.hasReady(this.cdb.recv, said);
  }

  private hasRevocationQueuedOrSent(said: string): boolean {
    return this.cdb.rev.get([said]) !== null ||
      this.cdb.rack.get([said]) !== null ||
      this.hasReady(this.cdb.revk, said);
  }

  private hasAcceptedGrantForCredential(said: string): boolean {
    for (const [, grant] of this.hby.db.exns.getTopItemIter()) {
      if (grant.route === IPEX_GRANT_ROUTE && credentialSaidFromGrant(grant) === said) {
        return true;
      }
    }
    return false;
  }

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

  private expired(dater: Dater): boolean {
    return this.services.clock.now() - new Date(dater.iso8601).getTime() > this.timeoutMs;
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

/** Rebuild grant-embedded `anc`, `iss`, and `acdc` streams from exchange storage. */
export function storedGrantArtifacts(
  hby: Habery,
  grant: SerderKERI,
): CredentialPresentationArtifacts {
  if (grant.route !== IPEX_GRANT_ROUTE || !grant.said) {
    throw new ValidationError(`Expected stored ${IPEX_GRANT_ROUTE} EXN.`);
  }
  const embeds = embeddedSection(grant);
  if (!embeds) {
    throw new ValidationError(`Grant ${grant.said} is missing embedded artifacts.`);
  }
  return {
    anc: concatBytes(keriRaw(embeds.anc, "anc"), pathedAttachment(hby, grant.said, "anc")),
    iss: concatBytes(keriRaw(embeds.iss, "iss"), pathedAttachment(hby, grant.said, "iss")),
    acdc: concatBytes(acdcRaw(embeds.acdc, "acdc"), pathedAttachment(hby, grant.said, "acdc")),
  };
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

function credentialSaidFromGrant(grant: SerderKERI): string | null {
  const embeds = embeddedSection(grant);
  const acdc = embeds?.acdc;
  return isRecord(acdc) && typeof acdc.d === "string" ? acdc.d : null;
}

function embeddedSection(serder: SerderKERI): Record<string, unknown> | null {
  const ked = serder.ked;
  if (!ked) {
    return null;
  }
  if (isRecord(ked.e)) {
    return ked.e;
  }
  const attrs = ked.a;
  return isRecord(attrs) && isRecord(attrs.e) ? attrs.e : null;
}

function keriRaw(value: unknown, label: string): Uint8Array {
  if (!isRecord(value)) {
    throw new ValidationError(`Grant embedded ${label} is missing.`);
  }
  return new SerderKERI({ sad: value }).raw;
}

function acdcRaw(value: unknown, label: string): Uint8Array {
  if (!isRecord(value)) {
    throw new ValidationError(`Grant embedded ${label} is missing.`);
  }
  return new SerderACDC({ sad: value, verify: false }).raw;
}

function pathedAttachment(hby: Habery, said: string, label: string): Uint8Array {
  const path = `/e/${label}`;
  for (const text of hby.db.epath.get([said])) {
    const raw = textEncoder.encode(text);
    const counter = new Counter({ qb64b: raw });
    const pather = parsePather(raw.slice(counter.fullSize), "txt");
    if (pather.path === path) {
      return raw.slice(counter.fullSize + pather.fullSize);
    }
  }
  return new Uint8Array();
}

function nowDater(): Dater {
  return new Dater({ qb64: encodeDateTimeToDater(makeNowIso8601()) });
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
