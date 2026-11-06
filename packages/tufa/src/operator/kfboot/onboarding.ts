/** Finite KF account onboarding over borrowed protocol owners and explicit witness credentials. */
import { concatBytes, Matter, parseBytes, Prefixer, type SerderKERI, Vrsn_2_0 } from "cesr-ts";
import { call, type Operation, race, sleep } from "effection";
import {
  acceptedEventReplayMessage,
  type Hab,
  isLocalGroupHab,
  type Receiptor,
  reply,
  ValidationError,
  type WitnessAuthMap,
} from "keri-ts/runtime";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { TOTP } from "npm:otpauth@9.4.1";
import { bootObject, bootText, KfBootClient, type KfBootReply } from "./client.ts";

/** Public allocation coordinates authenticated by the selected boot service. */
export interface KfAllocation {
  eid: string;
  url: string;
  oobis: string[];
}
/**
 * One witness's TOTP seed, stored as plaintext base32 in a 0600 file.
 *
 * The seed is encrypted only in transit (the witness's registration response).
 * Storing it under an account key would bind it to a key that rotation erases.
 */
interface WitnessCredential {
  eid: string;
  url: string;
  secret: string;
}
interface Credentials {
  account: string;
  provider: string;
  server: string;
  witnesses: WitnessCredential[];
}
/** Existing independent identities and one explicitly selected session/profile. */
export interface KfOnboardingOptions {
  client: KfBootClient;
  account: Hab;
  receiptor: Receiptor;
  profile: string;
  sessionId?: string;
  timeoutMs: number;
  credentialFile: string;
}
/** Public completion facts, suitable for command output without revealing authorization secrets. */
export interface KfOnboardingResult {
  sessionId: string;
  account: string;
  server: string;
  witnesses: KfAllocation[];
  watcher: KfAllocation | null;
  services: Record<string, { aid: string; roles: string[]; service: string; url: string; ca_pem: string }>;
  credentialFile: string;
}

/** Reject truncated identifiers and endpoint credentials before introducing remote state. */
function aid(value: unknown): string {
  const text = bootText(value, "AID");
  if (new Prefixer({ qb64: text }).qb64 !== text) throw new ValidationError("Invalid KF allocation AID.");
  return text;
}
function url(value: unknown): string {
  const parsed = new URL(bootText(value, "URL"));
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
    throw new ValidationError("KF endpoints require HTTP(S) without credentials or fragments.");
  }
  return parsed.href;
}
function allocation(value: unknown, account: string): KfAllocation {
  const row = bootObject(value, "allocation"), eid = aid(row.eid), endpoint = url(row.url);
  // KF binds resource cid at account/create; the signed session already binds this allocation.
  if ((row.cid !== "" && row.cid !== account) || !Array.isArray(row.oobis) || !row.oobis.length) {
    throw new ValidationError("KF allocation does not belong to the selected account or lacks OOBIs.");
  }
  const oobis = row.oobis.map(value => {
    const selected = url(value), parsed = new URL(selected);
    if (parsed.origin !== new URL(endpoint).origin || !parsed.pathname.startsWith(`/oobi/${eid}`)) {
      throw new ValidationError("KF allocation OOBI differs from its public endpoint/AID.");
    }
    return selected;
  });
  return { eid, url: endpoint, oobis };
}

const TOTP_SECRET = /^[A-Z2-7]{32}$/;

/** Open one transit ciphertext (a qb64 Ed25519_Seed-coded seed) with the account key it names. */
function decryptSeed(account: Hab, cipher: string, pubs: string[]): string {
  const plain = account.mgr.decrypt(cipher, { pubs });
  try {
    const secret = new TextDecoder().decode(new Matter({ qb64b: plain }).raw);
    if (!TOTP_SECRET.test(secret)) throw new ValidationError("Invalid witness credential.");
    return secret;
  } finally {
    plain.fill(0);
  }
}

/** Read only an explicitly selected artifact holding plaintext seeds. */
function credentials(account: Hab, path: string): Credentials {
  const raw = bootObject(JSON.parse(readFileSync(path, "utf8")), "witness credential artifact");
  if (raw.account !== account.pre || !Array.isArray(raw.witnesses)) {
    throw new ValidationError("Witness credentials belong to another account.");
  }
  return {
    account: account.pre,
    provider: url(raw.provider),
    server: aid(raw.server),
    witnesses: raw.witnesses.map(value => {
      const row = bootObject(value, "witness credential");
      if (typeof row.secret !== "string" || !TOTP_SECRET.test(row.secret)) {
        throw new ValidationError("Invalid witness credential.");
      }
      return { eid: aid(row.eid), url: url(row.url), secret: row.secret };
    }),
  };
}
/** Produce fresh receipt codes from the retained plaintext seeds. */
export function loadKfWitnessAuths(account: Hab, path: string): WitnessAuthMap {
  const saved = credentials(account, path), auths: WitnessAuthMap = {};
  const timestamp = Date.now();
  for (const row of saved.witnesses) {
    auths[row.eid] = new TOTP({ secret: row.secret }).generate({ timestamp }) + "#" + new Date(timestamp).toISOString();
  }
  return auths;
}

/** Replace the whole owner-only (0600) file; an interruption cannot leave half-written seeds. */
function saveCredentials(path: string, saved: Credentials): void {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(saved) + "\n", { flag: "wx", mode: 0o600 });
  renameSync(temporary, path);
}

/** Await the exact service-owned operation; no client-side operation record is created. */
function* operation(client: KfBootClient, response: KfBootReply): Operation<Record<string, unknown>> {
  let state = bootObject(response.payload.operation, "operation");
  const id = bootText(state.operation_id, "operation ID");
  while (true) {
    if (state.requester !== client.hab.pre) throw new ValidationError("KF operation has another principal.");
    if (state.state === "succeeded") return bootObject(state.result, "operation result");
    if (!["pending", "running"].includes(String(state.state))) throw new ValidationError("KF operation failed.");
    yield* sleep(500);
    state = bootObject((yield* client.operation(id)).payload.operation, "operation");
  }
}

/** Complete onboarding under one invocation deadline; cancellation joins the borrowed HTTP operations. */
export function* onboardKfAccount(options: KfOnboardingOptions): Operation<KfOnboardingResult> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new ValidationError("Positive timeout required.");
  }
  return yield* race([
    onboard(options),
    (function*(): Operation<never> {
      yield* sleep(options.timeoutMs);
      throw new ValidationError("KF onboarding timed out; reuse the explicit session and witness credentials.");
    })(),
  ]);
}

/** Compose registration, ordinary receipt ownership, watcher consent and account activation. */
function* onboard(
  { client, account, receiptor, profile, sessionId, credentialFile }: KfOnboardingOptions,
): Operation<KfOnboardingResult> {
  if (
    isLocalGroupHab(client.hby, account) || isLocalGroupHab(client.hby, client.hab) || client.hab.pre === account.pre
    || client.surface !== "onboarding" || account.db !== client.hby.db || receiptor.hby !== client.hby
    || receiptor.protocol !== client.protocol
  ) {
    throw new ValidationError(
      "KF onboarding requires distinct individual account/onboarding habitats and shared protocol owners.",
    );
  }
  if (
    !account.kever || !client.hab.kever
    || account.kever.verfers.some(key => client.hab.kever!.verfers.some(other => other.qb64 === key.qb64))
  ) {
    throw new ValidationError("Account and onboarding signer require distinct accepted keys.");
  }
  const selected = client.discovery.profiles.find(item => item.code === profile);
  if (!selected) throw new ValidationError("KF profile is not advertised.");
  // Bind every allocated resource to this signed session before contacting its endpoint.
  let response = sessionId ? yield* client.session(sessionId) : yield* client.start(account.pre, account.name, profile);
  sessionId = bootText(response.payload.session_id, "session ID");
  let rows: unknown[];
  while (true) {
    const state = response.payload;
    if (
      state.account_aid !== account.pre || state.ephemeral_aid !== client.hab.pre
      || state.chosen_profile_code !== profile || state.region_id !== client.discovery.region
      || state.witness_count !== selected.witnesses || state.toad !== selected.threshold
    ) {
      throw new ValidationError("KF session differs from selected account, signer or profile.");
    }
    if (["failed", "expired", "cancelled"].includes(String(state.state))) {
      throw new ValidationError("KF session is closed.");
    }
    if (!Array.isArray(state.witnesses)) throw new ValidationError("KF session lacks witness allocations.");
    rows = state.witnesses;
    if (rows.length === selected.witnesses && (!client.discovery.watcherRequired || state.watcher)) break;
    if (rows.length > selected.witnesses) throw new ValidationError("KF session has excess witnesses.");
    yield* sleep(500);
    response = yield* client.session(sessionId);
  }
  const witnesses = rows.map(row => allocation(row, account.pre));
  const watcher = response.payload.watcher ? allocation(response.payload.watcher, account.pre) : null;
  const ids = witnesses.map(row => row.eid);
  if (new Set(ids).size !== ids.length || watcher && ids.includes(watcher.eid)) {
    throw new ValidationError("KF allocations repeat an AID.");
  }
  const current = account.kever!;
  const matching = current.wits.length === ids.length && ids.every(id => current.wits.includes(id))
    && current.toader.num === BigInt(selected.threshold);
  if (current.wits.length && !matching) throw new ValidationError("Account already selects a different witness pool.");
  const server = client.serverAid!;
  const saved = existsSync(credentialFile)
    ? credentials(account, credentialFile)
    : { account: account.pre, provider: client.discovery.provider, server, witnesses: [] };
  if (
    saved.provider !== client.discovery.provider || saved.server !== server
    || saved.witnesses.some(row => !witnesses.some(wit => wit.eid === row.eid && wit.url === row.url))
  ) {
    throw new ValidationError("Witness credentials do not match this provider allocation.");
  }
  const ingest = function*(bytes: Uint8Array): Operation<void> {
    for (const frame of parseBytes(bytes)) yield* client.protocol.dispatch(frame, { local: false, escrows: true });
  };
  for (const resource of [...witnesses, ...(watcher ? [watcher] : [])]) {
    const evidence = yield* client.http.request(resource.oobis[0], { redirect: "error" });
    if (!evidence.ok) throw new ValidationError("Allocated OOBI is unavailable.");
    yield* ingest(evidence.body);
    if (
      !account.db.getKever(resource.eid)
      || !Object.values(account.fetchUrls(resource.eid)).some(value => url(value) === resource.url)
    ) {
      throw new ValidationError("Allocation OOBI did not authenticate its declared AID and URL.");
    }
  }
  for (const witness of witnesses) {
    if (saved.witnesses.some(row => row.eid === witness.eid)) continue;
    // Save the registration seed before rotation changes the current signing key.
    if (matching) throw new ValidationError("Rotated account requires its retained witness credentials.");
    const inception = acceptedEventReplayMessage(client.hby, account.pre, 0, Vrsn_2_0).message;
    const form = new FormData();
    form.set("kel", new Blob([new Uint8Array(inception)]), "inception.cesr");
    const encoded = new Response(form);
    const body = new Uint8Array(yield* call(() => encoded.arrayBuffer()));
    const registered = yield* client.http.request(new URL("/aids", witness.url).href, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": encoded.headers.get("Content-Type")!, "CESR-DESTINATION": witness.eid },
      body,
    });
    if (!registered.ok) throw new ValidationError(`Witness registration failed with HTTP ${registered.status}.`);
    const registration = bootObject(JSON.parse(new TextDecoder().decode(registered.body)), "registration");
    // The seed is encrypted to the inception key only in transit.
    const pubs = [(parseBytes(inception)[0].body as SerderKERI).verfers[0].qb64];
    const secret = decryptSeed(account, bootText(registration.totp, "encrypted TOTP"), pubs);
    saved.witnesses.push({ eid: witness.eid, url: witness.url, secret });
    saveCredentials(credentialFile, saved);
  }
  // Retry the accepted rotation and its missing receipts without creating another rotation.
  if (!matching) account.rotate({ adds: ids, cuts: [], toad: selected.threshold });
  if (!account.db.fullyWitnessed(account.kever!.serder)) {
    yield* receiptor.receipt(account.pre, {
      sn: account.kever!.sn,
      auths: loadKfWitnessAuths(account, credentialFile),
    });
  }
  if (!account.db.fullyWitnessed(account.kever!.serder)) {
    throw new ValidationError("Account rotation is not fully witnessed.");
  }
  if (watcher) {
    const post = function*(bytes: Uint8Array): Operation<void> {
      const result = yield* client.http.request(new URL("/", watcher.url).href, {
        method: "POST",
        redirect: "error",
        headers: { "Content-Type": "application/cesr", "CESR-DESTINATION": watcher.eid },
        body: bytes,
      });
      if (!result.ok) throw new ValidationError(`Watcher introduction failed with HTTP ${result.status}.`);
    };
    const endorsed = (route: string, data: Record<string, unknown>) =>
      account.endorse(reply(route, data, { pre: account.pre, pvrsn: Vrsn_2_0, gvrsn: Vrsn_2_0 }), { gvrsn: Vrsn_2_0 });
    const role = endorsed("/end/role/add", { cid: account.pre, role: "watcher", eid: watcher.eid });
    yield* ingest(role);
    for (const witness of witnesses) {
      yield* post(
        concatBytes(...client.hby.db.clonePreIter(witness.eid, 0, Vrsn_2_0), account.loadLocScheme(witness.eid)),
      );
    }
    yield* post(concatBytes(...client.hby.db.clonePreIter(account.pre, 0, Vrsn_2_0)));
    for (const witness of witnesses) {
      const observed = endorsed(`/watcher/${watcher.eid}/add`, {
        cid: account.pre,
        oid: account.pre,
        oobi: new URL(`/oobi/${account.pre}/witness/${witness.eid}`, witness.url).href,
      });
      yield* ingest(observed);
      yield* post(observed);
    }
  }
  // Account completion changes the authenticated principal used for subsequent provider operations.
  const payload = { session_id: sessionId, account_aid: account.pre };
  if (response.payload.state !== "completed") {
    const created = yield* client.request("/onboarding/account/create", {
      ...payload,
      account_alias: account.name,
      chosen_profile_code: profile,
      region_id: client.discovery.region,
      witness_eids: ids,
      watcher_eid: watcher?.eid ?? "",
    });
    if (created.payload.session_id !== sessionId || created.payload.account_aid !== account.pre) {
      throw new ValidationError("KF created another account.");
    }
  }
  const completed = yield* client.request("/onboarding/complete", payload);
  if (
    completed.payload.session_id !== sessionId || completed.payload.account_aid !== account.pre
    || bootObject(completed.payload.account, "completed account").status !== "onboarded"
  ) throw new ValidationError("KF account did not complete.");
  const permanent = new KfBootClient(
    client.hby,
    account,
    client.protocol,
    client.http,
    client.discovery,
    server,
    "account",
  );
  if (watcher) {
    while (true) {
      // Introduction alone is insufficient: require observed matching state at the selected quorum.
      const observed = yield* operation(
        permanent,
        yield* permanent.request("/account/watchers/status", { watcher_id: watcher.eid }),
      );
      if (observed.watcher_id !== watcher.eid || observed.controller_id !== account.pre) {
        throw new ValidationError("Watcher observation selects another account.");
      }
      const states = bootObject(observed.aids, "observations")[account.pre];
      const observations = states
        ? bootObject(bootObject(states, "observed account").witnesses, "observed witnesses")
        : {};
      if (
        ids.filter(id => {
          const row = observations[id] as Record<string, unknown> | undefined;
          return row?.response_received === true && row.state === "even" && row.sequence_number === account.kever!.sn
            && row.digest === account.kever!.said;
        }).length >= selected.threshold
      ) break;
      yield* sleep(500);
    }
  }
  const activated = yield* operation(permanent, yield* permanent.request("/account/services", {}));
  if (activated.account_aid !== account.pre) {
    throw new ValidationError("KF service capability belongs to another account.");
  }
  const services: KfOnboardingResult["services"] = {};
  for (const [kind, value] of Object.entries(bootObject(activated.services, "service capabilities"))) {
    const row = bootObject(value, "service capability"), role = kind === "registrar" ? "publisher" : "reader";
    if (
      !["registrar", "observer"].includes(kind) || row.aid !== account.pre || !Array.isArray(row.roles)
      || row.roles.length !== 1 || row.roles[0] !== role || typeof row.ca_pem !== "string"
    ) throw new ValidationError("Invalid KF service capability.");
    const endpoint = url(row.url);
    if (new URL(endpoint).protocol !== "https:") throw new ValidationError("Credential services require HTTPS.");
    services[kind] = { aid: account.pre, roles: [role], service: aid(row.service), url: endpoint, ca_pem: row.ca_pem };
  }
  return { sessionId, account: account.pre, server, witnesses, watcher, services, credentialFile };
}
