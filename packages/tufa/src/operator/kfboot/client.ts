/** KF provisioning client; the boot service owns allocations and the caller owns keys and consent. */
import { type CesrFrame, concatBytes, parseBytes, SerderKERI, Vrsn_2_0 } from "cesr-ts";
import { call, type Operation, scoped } from "effection";
import {
  acceptedEventReplayMessage,
  collectBytes,
  exchange,
  type Hab,
  type Habery,
  type HttpClient,
  type ProtocolProcessor,
  requestFrame,
  ValidationError,
} from "keri-ts/runtime";

/** Discovery describes available profiles, not authenticated account access. */
export interface KfBootDiscovery {
  provider: string;
  onboarding: string;
  account: string;
  region: string;
  watcherRequired: boolean;
  profiles: { code: string; witnesses: number; threshold: number }[];
}

/** Only these existing service operations are exposed by the initial allocation caller. */
export type KfBootRoute =
  | "/onboarding/session/start"
  | "/onboarding/session/status"
  | "/onboarding/cancel"
  | "/operations/status";

/** Accepted signed response; HTTP status and parsed JSON alone cannot produce this result. */
export interface KfBootReply {
  sender: string;
  said: string;
  route: KfBootRoute;
  payload: Record<string, unknown>;
}

/** Require the service contract's actual JSON object before reading its fields. */
export function bootObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`KF boot ${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

/** Require a public service coordinate without coercing malformed response values. */
export function bootText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ValidationError(`KF boot ${label} is missing.`);
  return value;
}

/** Explicit HTTP(S) endpoints retain normal transport certificate verification. */
function endpoint(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new ValidationError("KF boot requires an HTTP(S) endpoint without URL credentials or fragments.");
  }
  return url.href;
}

/** Read the existing JSON bootstrap contract; service identity is authenticated on the signed exchange. */
export function* discoverKfBoot(http: HttpClient, provider: string): Operation<KfBootDiscovery> {
  const base = endpoint(provider);
  const response = yield* http.request(new URL("/bootstrap/config", base).href, { redirect: "error" });
  if (!response.ok) throw new ValidationError(`KF boot discovery failed with HTTP ${response.status}.`);
  const body = bootObject(JSON.parse(new TextDecoder().decode(response.body)), "discovery");
  const bootstrap = bootObject(body.bootstrap, "bootstrap"), surfaces = bootObject(body.surfaces, "surfaces");
  const region = bootObject(body.region, "region");
  if (!Array.isArray(bootstrap.account_options) || typeof bootstrap.watcher_required !== "boolean") {
    throw new ValidationError("KF boot discovery lacks account profiles or watcher policy.");
  }
  const profiles = bootstrap.account_options.map(value => {
    const option = bootObject(value, "profile");
    const witnesses = option.witness_count, threshold = option.toad;
    if (
      !Number.isSafeInteger(witnesses) || !Number.isSafeInteger(threshold)
      || Number(witnesses) < 1 || Number(threshold) < 1 || Number(threshold) > Number(witnesses)
    ) {
      throw new ValidationError("KF boot profile has invalid witness coordinates.");
    }
    return { code: bootText(option.code, "profile code"), witnesses: Number(witnesses), threshold: Number(threshold) };
  });
  return {
    provider: base,
    onboarding: endpoint(bootText(bootObject(surfaces.onboarding, "onboarding surface").url, "onboarding URL")),
    account: endpoint(bootText(bootObject(surfaces.account, "account surface").url, "account URL")),
    region: bootText(region.id, "region ID"),
    watcherRequired: bootstrap.watcher_required,
    profiles,
  };
}

/** Finite signed requests over borrowed protocol/HTTP owners; acquire no stores, workers or client ledger. */
export class KfBootClient {
  private introduced?: string;
  private server?: string;

  constructor(
    readonly hby: Habery,
    readonly hab: Hab,
    readonly protocol: ProtocolProcessor,
    readonly http: HttpClient,
    readonly discovery: KfBootDiscovery,
    server?: string,
  ) {
    if (hab.db !== hby.db || protocol.kvy.db !== hby.db || !protocol.kvy.kramer) {
      throw new ValidationError("KF boot requires the selected habitat's KRAM-enabled protocol owner.");
    }
    this.server = server;
  }

  /** Bind the origin-verified first response for this invocation, or enforce an explicitly selected server AID. */
  get serverAid(): string | undefined {
    return this.server;
  }

  /** Consume the complete HTTP response inside the caller's scope; protocol acceptance happens separately. */
  private *post(frame: CesrFrame): Operation<Uint8Array> {
    const response = yield* requestFrame(this.discovery.onboarding, frame, this.http, { destination: this.server });
    const body = yield* call(() => collectBytes(response.body()));
    return concatBytes(body, new TextEncoder().encode(response.headers.get("CESR-ATTACHMENT") ?? ""));
  }

  /** Publish the current accepted KEL before business requests; no synthetic keystate is inserted. */
  private *introduce(): Operation<void> {
    const current = this.hab.kever;
    if (!current) throw new ValidationError("KF onboarding signer has no accepted key state.");
    if (this.introduced === current.said) return;
    for (let sn = 0; sn <= current.sn; sn++) {
      const { message } = acceptedEventReplayMessage(this.hby, this.hab.pre, sn, Vrsn_2_0);
      yield* scoped(() => this.post(parseBytes(message)[0]));
    }
    this.introduced = current.said;
  }

  /** Authenticate the exact returned exchange through KRAM and Exchanger before exposing its payload. */
  *request(route: KfBootRoute, payload: Record<string, unknown>): Operation<KfBootReply> {
    yield* this.introduce();
    const [request] = exchange(route, payload, {
      sender: this.hab.pre,
      recipient: this.server ?? "",
      version: Vrsn_2_0,
      gvrsn: Vrsn_2_0,
    });
    const frame = parseBytes(this.hab.endorse(request, { gvrsn: Vrsn_2_0 }))[0];
    const bytes = yield* scoped(() => this.post(frame));
    const frames = parseBytes(bytes), reply = frames.at(-1)?.body;
    if (
      !(reply instanceof SerderKERI) || reply.pvrsn.major !== 2 || reply.ilk !== "exn"
      || reply.route !== route || reply.sad!.ri !== this.hab.pre || !reply.pre
      || (this.server && reply.pre !== this.server)
    ) {
      throw new ValidationError("KF boot reply does not match the selected v2 service, route and recipient.");
    }
    // The server prepends public KEL evidence; no other business messages belong in this reply.
    for (const frame of frames.slice(0, -1)) {
      if (
        !(frame.body instanceof SerderKERI) || !["icp", "rot", "ixn", "dip", "drt", "rct"].includes(frame.body.ilk!)
      ) {
        throw new ValidationError("KF boot reply contains unexpected support messages.");
      }
      yield* this.protocol.dispatch(frame, { local: false });
    }
    const result = yield* this.protocol.dispatch(frames.at(-1)!, { local: false });
    if (result.decision?.kind !== "accept" || !this.protocol.exc.complete(reply.said!)) {
      throw new ValidationError("KF boot reply did not pass current KRAM and exchange authentication.");
    }
    this.server = reply.pre;
    return { sender: reply.pre, said: reply.said!, route, payload: bootObject(reply.sad!.a, "reply payload") };
  }

  /** Start/reuse one service-owned session; this allocates infrastructure but does not activate an account. */
  *start(account: string, alias: string, profile: string): Operation<KfBootReply> {
    if (!this.discovery.profiles.some(option => option.code === profile)) {
      throw new ValidationError(`KF boot does not advertise profile ${profile}.`);
    }
    const reply = yield* this.request("/onboarding/session/start", {
      account_aid: account,
      account_alias: alias,
      chosen_profile_code: profile,
      region_id: this.discovery.region,
      watcher_required: this.discovery.watcherRequired,
    });
    if (reply.payload.account_aid !== account) throw new ValidationError("KF boot allocated a different account.");
    bootText(reply.payload.session_id, "session ID");
    return reply;
  }

  /** Read only the explicitly selected session, authenticated by its onboarding principal. */
  *session(session: string): Operation<KfBootReply> {
    const reply = yield* this.request("/onboarding/session/status", { session_id: session });
    if (reply.payload.session_id !== session) throw new ValidationError("KF boot returned a different session.");
    return reply;
  }

  /** Observe one existing boot operation; its state does not imply protocol or account completion. */
  *operation(operation: string): Operation<KfBootReply> {
    const reply = yield* this.request("/operations/status", { operation_id: operation });
    if (bootObject(reply.payload.operation, "operation").operation_id !== operation) {
      throw new ValidationError("KF boot returned a different operation.");
    }
    return reply;
  }

  /** Explicitly cancel the selected onboarding session through the service's cleanup owner. */
  *cancel(session: string, reason = ""): Operation<KfBootReply> {
    const reply = yield* this.request("/onboarding/cancel", { session_id: session, reason });
    if (reply.payload.session_id !== session) throw new ValidationError("KF boot cancelled a different session.");
    return reply;
  }
}
