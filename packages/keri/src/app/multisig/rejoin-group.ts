/**
 * Rebuild a lost group habitat record from the group's accepted key state.
 *
 * A host can lose its store while its member identifier survives: the member is re-adopted at open
 * (`Habery.makeSignedHab` for a signer held outside the store), but the record of the group it belongs to
 * is gone. The group's KEL is still held by a co-member and reachable by OOBI. `rejoinGroup` resolves that
 * OOBI, waits until the group's key state is accepted locally, reads the signing and rotation members of the
 * group's latest accepted establishment event (`acceptedGroupMembers`, KERIpy `GroupHab.acceptedMembers`),
 * and records the group with `Habery.joinGroupHab`.
 *
 * Boundaries:
 * - Membership is decided by accepted key state only, never by caller-supplied member lists, and only by
 *   the member lists: a member whose signing weight is 0 is a member like any other.
 * - The group's key state names keys, not identifiers. Attributing each key to a member needs every
 *   member's KEL to be local, and a group OOBI carries the group's KEL only. A caller resolves the other
 *   members' OOBIs first (or the wait ends `timed-out` with `waiting: "member-key-state"`).
 * - Remote outcomes are returned (`RejoinResult`); only programmer misuse throws. A result other than
 *   `joined` writes no habitat record; key state the OOBI taught stays, as for any resolution.
 * - Only the record is rebuilt. Credentials, registry state and exchanges the store held come back by
 *   replay from a co-member (`listGroupDisclosures`, `exportDisclosureStream`, `importCredentialStream`); this call
 *   does not request it. `written: true` on the result says such a refill is due.
 * - Dependencies are declared collaborators (ADR-0013); an `AgentRuntime` fits.
 */
import type { Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import type { Baser } from "../../db/basing.ts";
import { beginOobi, type OobiStatus, oobiStatus } from "../bootstrap/oobi-resolving.ts";
import type { Oobiery } from "../bootstrap/oobiery.ts";
import type { RootReplicator } from "../credentials/root-replicator.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import type { KelPublisher } from "../mailbox/kel-publisher.ts";
import type { MailboxPoller } from "../mailbox/mailbox-poller.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import { type ChangeSink, observeUntil } from "../runtime/workflow-contract.ts";
import { type AcceptedGroupMembers, acceptedGroupMembers, isAcceptedGroupMember } from "./group-members.ts";

/** Collaborators of {@link rejoinGroup}. */
export interface RejoinDeps {
  /** The Habery that holds `member`; the group record is written here. */
  readonly hby: Habery;
  /** Durable OOBI job owner; only its queueing entry is used. Something must be running it. */
  readonly oobiery: Pick<Oobiery, "resolve">;
  /** The runtime clock that bounds the wait. */
  readonly clock: Pick<RuntimeClock, "now">;
  /** Prompted for the group after a join, so the poller selects the group's mailboxes on its next tock. */
  readonly mailboxPoller: Pick<MailboxPoller, "prompt">;
  /** Prompted for the group after a join, so the group's KEL is posted to its mailboxes on the next tock. */
  readonly kelPublisher: Pick<KelPublisher, "prompt">;
  /** Prompted for the group after a join, or null for a runtime without one. */
  readonly rootReplicator: Pick<RootReplicator, "prompt"> | null;
  /** Told `{kind:"oobi"}` when the OOBI is queued and `{kind:"group"}` after a join. */
  readonly changes?: ChangeSink;
}

/** What {@link rejoinGroup} needs. */
export interface RejoinInput {
  /** OOBI of the group, served by a co-member that holds its KEL. */
  oobi: string;
  /** Group prefix. */
  group: string;
  /** The Habery's single-signature habitat that is a member in the group's accepted key state. */
  member: Hab;
  /** Local alias the group record takes. */
  alias: string;
  /** Wait budget on `deps.clock`, from queueing the OOBI to the member lists being readable. */
  timeoutMs: number;
  /** Namespace of the alias; the default namespace when absent. */
  domain?: string;
}

/** What a `timed-out` rejoin was still waiting for. */
export type RejoinWait =
  /** The OOBI had not reached a terminal state. */
  | "oobi"
  /** The OOBI is done but the group has no accepted key state here (for example, an event is in escrow). */
  | "group-key-state"
  /** The member is in the group's accepted key state, but not every key of it can be attributed to a local KEL. */
  | "member-key-state";

/**
 * Outcome of {@link rejoinGroup}:
 * - `joined`: the record names `member`; `smids` and `rmids` are the accepted members recorded (on a repeat,
 *   the members already recorded). `written` is true when this call wrote the record and false when it found the
 *   record already there. A written record means this identifier was already a member and this store had no record
 *   of the group, so the store holds none of the group's credentials either: the embedder's signal to refill them
 *   from a co-member.
 * - `not-member`: `member` is in neither the signing nor the rotation members of the accepted state.
 * - `oobi-failed`: the OOBI failed and the group has no accepted key state here; `reason` is the Oobiery's.
 * - `timed-out`: the budget expired; `waiting` says on what.
 *
 * Only `joined` writes a habitat record.
 */
export type RejoinResult =
  | {
    outcome: "joined";
    group: string;
    alias: string;
    smids: readonly string[];
    rmids: readonly string[];
    written: boolean;
  }
  | { outcome: "not-member"; group: string; member: string }
  | { outcome: "oobi-failed"; group: string; reason: string }
  | { outcome: "timed-out"; group: string; timeoutMs: number; waiting: RejoinWait };

/** One read of where a rejoin stands; `members` and `not-member` end the wait. */
type RejoinReading =
  | { kind: "waiting"; waiting: RejoinWait }
  | { kind: "oobi-failed"; reason: string }
  | { kind: "not-member" }
  | { kind: "members"; members: AcceptedGroupMembers };

/**
 * Resolve `input.oobi`, wait for the group's accepted key state, and record the group with `input.member` as
 * its local member, using the accepted members. Then the mailbox poller, the KEL publisher and the root
 * replicator are prompted for the group, so each acts for it on its next tock. Creates no event and signs
 * nothing. Observe-only: the host must already run the runtime's workers (see `workflow-contract.ts`).
 *
 * A record that already names `member` returns `joined` at once with `written: false`, with no OOBI and no write.
 *
 * @throws ValidationError for misuse: `member` is not a local single-signature habitat, `group` is a local
 * single-signature habitat, the group already has a local record naming a different member (use
 * `replaceGroupMember`), or `alias` is bound to another prefix.
 */
export function* rejoinGroup(deps: RejoinDeps, input: RejoinInput): Operation<RejoinResult> {
  const { hby } = deps, { group, member, alias, timeoutMs, domain } = input;
  const recorded = rejoinedRecord(hby, input);
  if (recorded) return recorded;
  beginOobi(deps, input.oobi);
  const read = () => readRejoin(hby.db, input.oobi, group, member.pre!);
  yield* observeUntil(() => read().kind !== "waiting", { timeoutMs, clock: deps.clock });
  const reading = read();
  switch (reading.kind) {
    case "waiting":
      return { outcome: "timed-out", group, timeoutMs, waiting: reading.waiting };
    case "oobi-failed":
      return { outcome: "oobi-failed", group, reason: reading.reason };
    case "not-member":
      return { outcome: "not-member", group, member: member.pre! };
  }
  const { smids, rmids } = reading.members;
  if (!smids.includes(member.pre!) && !rmids.includes(member.pre!)) {
    return { outcome: "not-member", group, member: member.pre! };
  }
  hby.joinGroupHab(group, alias, member, smids, rmids, domain);
  deps.mailboxPoller.prompt(group);
  deps.kelPublisher.prompt(group);
  deps.rootReplicator?.prompt(group);
  deps.changes?.push({ kind: "group", id: group });
  return { outcome: "joined", group, alias, smids, rmids, written: true };
}

/**
 * Refuse misuse before any I/O, and return `joined` for a record that already names the member.
 * Null when the group has no local record yet.
 */
function rejoinedRecord(hby: Habery, { group, member, alias, domain }: RejoinInput): RejoinResult | null {
  if (!group) throw new ValidationError("Group prefix is required.");
  if (!alias) throw new ValidationError("Group alias is required.");
  const pre = member.pre;
  if (!pre || hby.habs.get(pre) !== member) {
    throw new ValidationError(`Member ${pre} is not a habitat of this Habery.`);
  }
  if (hby.db.getHab(pre)?.mid) {
    throw new ValidationError(
      `Member ${pre} is a group identifier; a group rejoins through a single-signature member.`,
    );
  }
  const record = hby.db.getHab(group);
  if (record && !record.mid) {
    throw new ValidationError(`${group} is a local single-signature identifier, not a group.`);
  }
  if (record?.mid && record.mid !== pre) {
    throw new ValidationError(
      `Group ${group} is already recorded with local member ${record.mid}; use replaceGroupMember to change it.`,
    );
  }
  if (record?.mid) {
    return {
      outcome: "joined",
      group,
      alias: record.name ?? alias,
      smids: [...(record.smids ?? [])],
      rmids: [...(record.rmids ?? [])],
      written: false,
    };
  }
  const bound = hby.db.getName(domain ?? "", alias);
  if (bound && bound !== group) throw new ValidationError(`Alias ${alias} is already bound to ${bound}.`);
  return null;
}

/** Read the OOBI, the group's accepted key state and its members, in that order. */
function readRejoin(db: Baser, oobi: string, group: string, member: string): RejoinReading {
  const status: OobiStatus = oobiStatus({ db }, oobi);
  if (status.state === "pending") return { kind: "waiting", waiting: "oobi" };
  if (!db.getKever(group)) {
    return status.state === "failed"
      ? { kind: "oobi-failed", reason: status.reason }
      : { kind: "waiting", waiting: "group-key-state" };
  }
  // Every list member is an accepted member, so this answers `not-member` before the other members' KELs arrive.
  if (!isAcceptedGroupMember(db, group, member)) return { kind: "not-member" };
  const candidates = [...db.states.getTopItemIter()].map(([keys]) => keys.join("."));
  const members = acceptedGroupMembers(db, group, candidates);
  return members ? { kind: "members", members } : { kind: "waiting", waiting: "member-key-state" };
}
