/**
 * KF boot service records: onboarding sessions, accounts, hosted resources and operations.
 *
 * Port of kf-boot's `basing.py` records and the session/account/resource/operation parts
 * of `store.py`. Records keep kf-boot's snake_case field names because the signed reply
 * payloads (`sessionPayload`, `accountPayload`, `operationPayload`, `resourceToApi`) expose
 * them byte-for-byte to Locksmith and Tufa. Protocol facts (KELs, receipts, exchanges) stay
 * in the boot service's Habery; these tables hold only provider bookkeeping.
 *
 * TypeScript divergences, deliberately out of scope (Python-only by justification): per-IP
 * quotas, cleanup tasks and their sweeper, capacity counters. Sessions and accounts expire
 * on access only, and closed rows are never purged, so completed sessions stay readable
 * for `tufa infra kf onboard --session` recovery.
 */
import type { Operation } from "effection";
import { Komer, LMDBer, type LMDBerOptions } from "keri-ts/db";
import { RawRecord } from "keri-ts/runtime";

/** Session lifecycle states (`basing.py`). */
export const SessionStates = {
  started: "started",
  witnessPoolAllocated: "witness_pool_allocated",
  accountCreated: "account_created",
  completed: "completed",
  expired: "expired",
  failed: "failed",
  cancelled: "cancelled",
} as const;
export type SessionState = typeof SessionStates[keyof typeof SessionStates];

/** States after which a session admits no further onboarding progress. */
export const TERMINAL_SESSION_STATES: ReadonlySet<string> = new Set([
  SessionStates.completed,
  SessionStates.expired,
  SessionStates.failed,
  SessionStates.cancelled,
]);

/** Account lifecycle states. */
export const AccountStates = {
  pendingOnboarding: "pending_onboarding",
  onboarded: "onboarded",
  expired: "expired",
  failed: "failed",
} as const;

/** Asynchronous boot operation kinds. */
export const OperationKinds = {
  sessionProvision: "session_provision",
  watcherStatusQuery: "watcher_status_query",
  resourceDelete: "resource_delete",
  accountDelete: "account_delete",
  accountServices: "account_services",
} as const;

/** Asynchronous boot operation states. */
export const OperationStates = {
  pending: "pending",
  running: "running",
  succeeded: "succeeded",
  failed: "failed",
} as const;

const ACTIVE_OPERATION_STATES: ReadonlySet<string> = new Set([OperationStates.pending, OperationStates.running]);

/** Python `datetime.now(UTC).isoformat()`: microsecond precision with a `+00:00` offset. */
export function nowIso(at = Date.now()): string {
  return new Date(at).toISOString().replace(/\.(\d{3})Z$/, ".$1000+00:00");
}

/** Add seconds to an ISO timestamp, keeping the Python representation. */
export function isoPlus(iso: string, seconds: number): string {
  return nowIso(Date.parse(iso) + seconds * 1000);
}

/** Random URL-safe identifier, as `secrets.token_urlsafe(12)`. */
function token(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_");
}

/** One onboarding session owned by an ephemeral signer and bound to one account AID. */
export interface Session {
  session_id: string;
  ephemeral_aid: string;
  account_aid: string;
  account_alias: string;
  state: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  client_ip: string;
  chosen_profile_code: string;
  witness_backend_ids: string[];
  witness_eids: string[];
  watcher_eid: string;
  watcher_required: boolean;
  region_id: string;
  region_name: string;
  witness_count: number;
  toad: number;
  account_tier: string;
  failure_reason: string;
  expired_at: string;
  resources_cleaned_at: string;
}
/** Durable session row. */
export class SessionRecord extends RawRecord<Session> implements Session {
  declare session_id: string;
  declare ephemeral_aid: string;
  declare account_aid: string;
  declare account_alias: string;
  declare state: string;
  declare created_at: string;
  declare updated_at: string;
  declare expires_at: string;
  declare client_ip: string;
  declare chosen_profile_code: string;
  declare witness_backend_ids: string[];
  declare witness_eids: string[];
  declare watcher_eid: string;
  declare watcher_required: boolean;
  declare region_id: string;
  declare region_name: string;
  declare witness_count: number;
  declare toad: number;
  declare account_tier: string;
  declare failure_reason: string;
  declare expired_at: string;
  declare resources_cleaned_at: string;
}

/** One permanent account created from a session. */
export interface Account {
  account_aid: string;
  account_alias: string;
  status: string;
  created_at: string;
  onboarded_at: string;
  witness_profile_code: string;
  witness_count: number;
  toad: number;
  watcher_required: boolean;
  region_id: string;
  region_name: string;
  session_id: string;
  witness_eids: string[];
  watcher_eid: string;
  tier: string;
  expires_at: string;
  expired_at: string;
  resources_cleaned_at: string;
}
/** Durable account row. */
export class AccountRecord extends RawRecord<Account> implements Account {
  declare account_aid: string;
  declare account_alias: string;
  declare status: string;
  declare created_at: string;
  declare onboarded_at: string;
  declare witness_profile_code: string;
  declare witness_count: number;
  declare toad: number;
  declare watcher_required: boolean;
  declare region_id: string;
  declare region_name: string;
  declare session_id: string;
  declare witness_eids: string[];
  declare watcher_eid: string;
  declare tier: string;
  declare expires_at: string;
  declare expired_at: string;
  declare resources_cleaned_at: string;
}

/** One hosted witness/watcher allocation or registrar/observer enrollment. */
export interface Resource {
  kind: string;
  eid: string;
  backend_id: string;
  cid: string;
  principal: string;
  session_id: string;
  name: string;
  identifier_alias: string;
  region_id: string;
  region_name: string;
  url: string;
  boot_url: string;
  public_host: string;
  public_port: number | null;
  oobis: string[];
  status: string;
  created_at: string;
  /** Credential-service rows are keyed by enrolled account, not the shared service AID. */
  service_aid: string;
  ca_pem: string;
}
/** Durable resource row, keyed by `[kind, eid]`. */
export class ResourceRecord extends RawRecord<Resource> implements Resource {
  declare kind: string;
  declare eid: string;
  declare backend_id: string;
  declare cid: string;
  declare principal: string;
  declare session_id: string;
  declare name: string;
  declare identifier_alias: string;
  declare region_id: string;
  declare region_name: string;
  declare url: string;
  declare boot_url: string;
  declare public_host: string;
  declare public_port: number | null;
  declare oobis: string[];
  declare status: string;
  declare created_at: string;
  declare service_aid: string;
  declare ca_pem: string;
}

/** One asynchronous provider operation, readable by its principals through `/operations/status`. */
export interface BootOperation {
  operation_id: string;
  kind: string;
  subject: string;
  requester: string;
  route: string;
  state: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  last_error: string;
  attempt_count: number;
  created_at: string;
  updated_at: string;
  due_at: string;
  claimed_at: string;
  last_attempt_at: string;
}
/** Durable operation row. */
export class BootOperationRecord extends RawRecord<BootOperation> implements BootOperation {
  declare operation_id: string;
  declare kind: string;
  declare subject: string;
  declare requester: string;
  declare route: string;
  declare state: string;
  declare idempotency_key: string;
  declare payload: Record<string, unknown>;
  declare result: Record<string, unknown>;
  declare last_error: string;
  declare attempt_count: number;
  declare created_at: string;
  declare updated_at: string;
  declare due_at: string;
  declare claimed_at: string;
  declare last_attempt_at: string;
}

/** LMDB tables for one boot service. */
export class BootServiceBaser extends LMDBer {
  sessions!: Komer<SessionRecord>;
  accounts!: Komer<AccountRecord>;
  resources!: Komer<ResourceRecord>;
  operations!: Komer<BootOperationRecord>;

  constructor(options: LMDBerOptions = {}) {
    super(options, {
      tailDirPath: "keri/boot-service",
      cleanTailDirPath: "keri/clean/boot-service",
      altTailDirPath: ".tufa/boot-service",
      altCleanTailDirPath: ".tufa/clean/boot-service",
      tempPrefix: "keri_boot_service_",
    });
  }

  /** Rebind every table after opening the environment. */
  override *reopen(options: Partial<LMDBerOptions> = {}): Operation<boolean> {
    if (!(yield* super.reopen(options))) return false;
    this.sessions = new Komer(this, { subkey: "sessions.", recordClass: SessionRecord });
    this.accounts = new Komer(this, { subkey: "accounts.", recordClass: AccountRecord });
    this.resources = new Komer(this, { subkey: "resources.", recordClass: ResourceRecord });
    this.operations = new Komer(this, { subkey: "operations.", recordClass: BootOperationRecord });
    return true;
  }
}

/** Fields a new session takes from the start request and selected profile. */
export interface NewSession {
  ephemeral_aid: string;
  account_aid: string;
  account_alias: string;
  chosen_profile_code: string;
  client_ip: string;
  region_id: string;
  region_name: string;
  watcher_required: boolean;
  witness_count: number;
  toad: number;
  account_tier: string;
}

/** Newest-first by creation time, as kf-boot sorts its listings. */
function newest<T extends { created_at: string }>(rows: T[]): T[] {
  return rows.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

/** Store operations over `BootServiceBaser`, mirroring kf-boot `Store`. */
export class BootServiceStore {
  constructor(
    readonly db: BootServiceBaser,
    readonly sessionTtlSeconds: number,
    readonly accountTtlSeconds: number,
  ) {}

  // Sessions

  /** Create a started session whose lease runs for the session TTL. */
  createSession(fields: NewSession): SessionRecord {
    const created = nowIso();
    const record = new SessionRecord({
      ...fields,
      session_id: `sess_${token()}`,
      state: SessionStates.started,
      created_at: created,
      updated_at: created,
      expires_at: isoPlus(created, this.sessionTtlSeconds),
      witness_backend_ids: [],
      witness_eids: [],
      watcher_eid: "",
      failure_reason: "",
      expired_at: "",
      resources_cleaned_at: "",
    });
    this.saveSession(record);
    return record;
  }

  /** Persist a session; corrupt expiry metadata on an open session fails closed to expired. */
  saveSession(record: SessionRecord): void {
    if (
      !TERMINAL_SESSION_STATES.has(record.state) && record.expires_at && Number.isNaN(Date.parse(record.expires_at))
    ) {
      const current = nowIso();
      record.state = SessionStates.expired;
      record.expired_at ||= current;
      record.updated_at = current;
    }
    this.db.sessions.pin([record.session_id], record);
  }

  /** Read one session. */
  getSession(id: string): SessionRecord | null {
    return this.db.sessions.get([id]) ?? null;
  }

  /** Latest session matching a predicate. */
  private latestSession(match: (record: SessionRecord) => boolean): SessionRecord | null {
    let latest: SessionRecord | null = null;
    for (const [, record] of this.db.sessions.getTopItemIter()) {
      if (match(record) && (!latest || record.created_at > latest.created_at)) latest = record;
    }
    return latest;
  }

  /** Latest session started by this onboarding signer. */
  findSessionForEphemeral(aid: string): SessionRecord | null {
    return this.latestSession(record => record.ephemeral_aid === aid);
  }

  /** Latest session bound to this account. */
  findSessionForAccount(aid: string): SessionRecord | null {
    return this.latestSession(record => record.account_aid === aid);
  }

  /** Every session bound to this account, newest first. */
  listSessionsForAccount(aid: string): SessionRecord[] {
    return newest([...this.db.sessions.getTopItemIter()].map(([, r]) => r).filter(r => r.account_aid === aid));
  }

  /** Remove one session row. */
  deleteSession(id: string): void {
    this.db.sessions.rem([id]);
  }

  /** Extend an open session's lease from now. */
  refreshSessionLease(record: SessionRecord, now = nowIso()): void {
    record.updated_at = now;
    if (!TERMINAL_SESSION_STATES.has(record.state)) record.expires_at = isoPlus(now, this.sessionTtlSeconds);
    this.saveSession(record);
  }

  // Accounts

  /** Persist an account; corrupt expiry metadata on an onboarded account fails closed to expired. */
  saveAccount(record: AccountRecord): void {
    if (record.status === AccountStates.onboarded && record.expires_at && Number.isNaN(Date.parse(record.expires_at))) {
      record.status = AccountStates.expired;
      record.expired_at ||= nowIso();
    }
    this.db.accounts.pin([record.account_aid], record);
  }

  /** Read one account. */
  getAccount(aid: string): AccountRecord | null {
    return this.db.accounts.get([aid]) ?? null;
  }

  /** Remove one account row. */
  deleteAccount(aid: string): void {
    this.db.accounts.rem([aid]);
  }

  /** Extend an onboarded, unexpired account's idle lease. */
  refreshAccountLease(record: AccountRecord, now = nowIso()): void {
    if (record.status !== AccountStates.onboarded || this.accountTtlSeconds <= 0) return;
    if (record.expires_at) {
      const expires = Date.parse(record.expires_at);
      if (Number.isNaN(expires) || expires <= Date.parse(now)) return;
    }
    record.expires_at = isoPlus(now, this.accountTtlSeconds);
    this.saveAccount(record);
  }

  // Resources

  /** Insert or replace one resource. */
  saveResource(record: ResourceRecord): void {
    this.db.resources.pin([record.kind, record.eid], record);
  }

  /** Read one resource. */
  getResource(kind: string, eid: string): ResourceRecord | null {
    return this.db.resources.get([kind, eid]) ?? null;
  }

  /** Read resources in the given order, skipping missing rows. */
  getResources(kind: string, eids: readonly string[]): ResourceRecord[] {
    return eids.map(eid => this.getResource(kind, eid)).filter((row): row is ResourceRecord => row !== null);
  }

  /** Remove one resource row. */
  deleteResource(kind: string, eid: string): void {
    this.db.resources.rem([kind, eid]);
  }

  /** Resources of one kind matching a predicate, newest first. */
  private listResources(kind: string, match: (record: ResourceRecord) => boolean): ResourceRecord[] {
    const rows = [...this.db.resources.getTopItemIter([kind])].map(([, r]) => r);
    return newest(rows.filter(r => r.kind === kind && match(r)));
  }

  /** Resources owned by an account principal. */
  listResourcesForAccount(kind: string, aid: string): ResourceRecord[] {
    return this.listResources(kind, record => record.principal === aid);
  }

  /** Resources allocated for a session. */
  listResourcesForSession(kind: string, sessionId: string): ResourceRecord[] {
    return this.listResources(kind, record => record.session_id === sessionId);
  }

  /** Session allocations become durable account resources once the account exists. */
  bindResourcesToAccount(session: SessionRecord, aid: string): void {
    const rows = [
      ...this.getResources("witness", session.witness_eids),
      ...(session.watcher_eid ? this.getResources("watcher", [session.watcher_eid]) : []),
    ];
    for (const record of rows) {
      record.principal = aid;
      record.cid = aid;
      this.saveResource(record);
    }
  }

  // Operations

  /** Read one operation. */
  getOperation(id: string): BootOperationRecord | null {
    return this.db.operations.get([id]) ?? null;
  }

  /** Every operation matching the given coordinates, newest first. */
  listOperations(filter: { kind?: string; subject?: string; requester?: string } = {}): BootOperationRecord[] {
    const rows = [...this.db.operations.getTopItemIter()].map(([, r]) => r).filter(r =>
      (filter.kind === undefined || r.kind === filter.kind)
      && (filter.subject === undefined || r.subject === filter.subject)
      && (filter.requester === undefined || r.requester === filter.requester)
    );
    return newest(rows);
  }

  /** Latest pending or running operation for this requester/kind/subject. */
  findActiveOperation(kind: string, subject: string, requester: string): BootOperationRecord | null {
    return this.listOperations({ kind, subject, requester }).find(r => ACTIVE_OPERATION_STATES.has(r.state)) ?? null;
  }

  /** Create an operation or reuse active work for the same requester/kind/subject. */
  ensureOperation(
    fields: { kind: string; subject: string; requester: string; route: string; payload: Record<string, unknown> },
  ): BootOperationRecord {
    const existing = this.findActiveOperation(fields.kind, fields.subject, fields.requester);
    if (existing) return existing;
    const current = nowIso();
    const record = new BootOperationRecord({
      ...fields,
      operation_id: `op_${token()}`,
      state: OperationStates.pending,
      idempotency_key: "",
      result: {},
      last_error: "",
      attempt_count: 0,
      created_at: current,
      updated_at: current,
      due_at: current,
      claimed_at: "",
      last_attempt_at: "",
    });
    this.db.operations.pin([record.operation_id], record);
    return record;
  }

  /** Claim the earliest-due pending operation for the single worker, if any is due. */
  claimDueOperation(now = nowIso()): BootOperationRecord | null {
    const due = [...this.db.operations.getTopItemIter()].map(([, r]) => r)
      .filter(r => r.state === OperationStates.pending && r.due_at && Date.parse(r.due_at) <= Date.parse(now))
      .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at))[0];
    if (!due) return null;
    due.state = OperationStates.running;
    due.due_at = "";
    due.updated_at = now;
    due.claimed_at = now;
    due.last_attempt_at = now;
    due.attempt_count += 1;
    this.db.operations.pin([due.operation_id], due);
    return due;
  }

  /** Make operations claimed by a previous process visible again. */
  requeueClaimedOperations(now = nowIso()): number {
    let recovered = 0;
    for (const [, record] of this.db.operations.getTopItemIter()) {
      if (!record.claimed_at || record.state !== OperationStates.running) continue;
      Object.assign(record, { state: OperationStates.pending, due_at: now, updated_at: now, claimed_at: "" });
      this.db.operations.pin([record.operation_id], record);
      recovered++;
    }
    return recovered;
  }

  /** Return a failed attempt to the queue at `due_at`. */
  rescheduleOperation(id: string, due_at: string, last_error: string): void {
    const record = this.getOperation(id);
    if (!record) return;
    Object.assign(record, { state: OperationStates.pending, due_at, updated_at: nowIso(), claimed_at: "", last_error });
    this.db.operations.pin([id], record);
  }

  /** Record a successful result. */
  succeedOperation(id: string, result: Record<string, unknown>): void {
    const record = this.getOperation(id);
    if (!record) return;
    Object.assign(record, {
      state: OperationStates.succeeded,
      result,
      last_error: "",
      due_at: "",
      claimed_at: "",
      updated_at: nowIso(),
    });
    this.db.operations.pin([id], record);
  }

  /** Record a permanent failure; a failed provision also fails its open session. */
  failOperation(id: string, last_error: string, result: Record<string, unknown> = {}): void {
    const record = this.getOperation(id);
    if (!record) return;
    const current = nowIso();
    Object.assign(record, {
      state: OperationStates.failed,
      result,
      last_error,
      due_at: "",
      claimed_at: "",
      updated_at: current,
    });
    if (record.kind === OperationKinds.sessionProvision) {
      const session = this.getSession(String(record.payload.session_id || record.subject));
      if (session && !TERMINAL_SESSION_STATES.has(session.state)) {
        Object.assign(session, { state: SessionStates.failed, failure_reason: last_error, updated_at: current });
        this.saveSession(session);
      }
    }
    this.db.operations.pin([id], record);
  }

  // Reply payloads

  /** `store.sessionPayload`. */
  sessionPayload(session: Session): Record<string, unknown> {
    return {
      session_id: session.session_id,
      ephemeral_aid: session.ephemeral_aid,
      account_aid: session.account_aid,
      account_alias: session.account_alias,
      account_tier: session.account_tier,
      state: session.state,
      created_at: session.created_at,
      updated_at: session.updated_at,
      expires_at: session.expires_at,
      chosen_profile_code: session.chosen_profile_code,
      witness_eids: [...session.witness_eids],
      watcher_eid: session.watcher_eid,
      watcher_required: session.watcher_required,
      region_id: session.region_id,
      region_name: session.region_name,
      witness_count: session.witness_count,
      toad: session.toad,
      failure_reason: session.failure_reason,
      expired_at: session.expired_at,
      resources_cleaned_at: session.resources_cleaned_at,
    };
  }

  /** `store.accountPayload`. */
  accountPayload(account: Account): Record<string, unknown> {
    return {
      account_aid: account.account_aid,
      account_alias: account.account_alias,
      tier: account.tier,
      status: account.status,
      created_at: account.created_at,
      onboarded_at: account.onboarded_at,
      expires_at: account.expires_at,
      witness_profile_code: account.witness_profile_code,
      witness_count: account.witness_count,
      toad: account.toad,
      watcher_required: account.watcher_required,
      region_id: account.region_id,
      region_name: account.region_name,
      session_id: account.session_id,
      witness_eids: [...account.witness_eids],
      watcher_eid: account.watcher_eid,
      expired_at: account.expired_at,
      resources_cleaned_at: account.resources_cleaned_at,
    };
  }

  /** `store.bootOperationPayload`. */
  operationPayload(operation: BootOperation): Record<string, unknown> {
    return {
      operation_id: operation.operation_id,
      kind: operation.kind,
      subject: operation.subject,
      requester: operation.requester,
      route: operation.route,
      state: operation.state,
      idempotency_key: operation.idempotency_key,
      payload: structuredClone(operation.payload),
      result: structuredClone(operation.result),
      last_error: operation.last_error,
      attempt_count: operation.attempt_count,
      created_at: operation.created_at,
      updated_at: operation.updated_at,
      due_at: operation.due_at,
      claimed_at: operation.claimed_at,
      last_attempt_at: operation.last_attempt_at,
    };
  }
}

/** `store._resourceToApi`: `boot_url` only in session replies, plus the kind-specific URL alias. */
export function resourceToApi(record: Resource, includeBootUrl = false): Record<string, unknown> {
  const data: Record<string, unknown> = {
    kind: record.kind,
    eid: record.eid,
    cid: record.cid,
    name: record.name,
    identifier_alias: record.identifier_alias,
    region_id: record.region_id,
    region_name: record.region_name,
    url: record.url,
    boot_url: record.boot_url,
    public_host: record.public_host,
    public_port: record.public_port,
    status: record.status,
    created_at: record.created_at,
  };
  if (!includeBootUrl) delete data.boot_url;
  data.oobis = [...record.oobis];
  if (record.kind === "witness") data.witness_url = record.url;
  else if (record.kind === "watcher") data.watcher_url = record.url;
  return data;
}

/** `store.makeRecord`: a new allocation row with its public host and port split out. */
export function makeResource(fields: {
  kind: string;
  eid: string;
  backend_id?: string;
  session_id: string;
  name: string;
  identifier_alias: string;
  region_id: string;
  region_name: string;
  public_url: string;
  boot_url: string;
  oobis: string[];
  status: string;
}): ResourceRecord {
  const url = new URL(fields.public_url);
  const port = url.port ? Number(url.port) : null;
  return new ResourceRecord({
    kind: fields.kind,
    eid: fields.eid,
    backend_id: fields.backend_id ?? "",
    cid: "",
    principal: "",
    session_id: fields.session_id,
    name: fields.name,
    identifier_alias: fields.identifier_alias,
    region_id: fields.region_id,
    region_name: fields.region_name,
    url: fields.public_url,
    boot_url: fields.boot_url,
    public_host: url.hostname,
    public_port: port,
    oobis: [...fields.oobis],
    status: fields.status,
    created_at: nowIso(),
    service_aid: "",
    ca_pem: "",
  });
}
