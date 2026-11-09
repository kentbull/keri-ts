# Peer protocol version selection

Status: implemented for delivery and upgrade rotation. Prerequisite [#830](https://github.com/kentbull/keri-ts/issues/830) has landed.

## Problem

keri-ts must keep working with KERIpy 1.x hosts, which cannot read KERI v2. A v1 parser
treats a v2 version string as an extraction error and discards the rest of its stream, so
egress must not guess v2. Egress versions are chosen today by hardcoded defaults and
per-command flags, without regard to the peer.

## Rule

Before serializing for a peer, select its version in this order:

1. An explicit caller flag.
2. The version of the latest accepted event in that AID's KEL, if it is v2.
3. Otherwise v1, including when the AID is unknown.

The rule uses the latest event of any type, read from `Kever.serder`, because a KEL can
move from v1 to v2 after inception. `Kever.version` and the key state `vn` stay at the
inception version and must not be used. The head of the KEL adds nothing, since a v1 head
with a v2 tail is the upgrade case the rule exists to honor.

Each AID is judged by its own KEL. A controller's KEL says nothing about its witnesses,
mailboxes or agents.

## Consequences

| Case                                        | Result                                                   |
| ------------------------------------------- | -------------------------------------------------------- |
| v1 KEL on a v2-capable host                 | Treated as v1. Readable, but v2 features stay unused.    |
| Local copy of a peer's KEL lags its upgrade | Sends v1, which a v2 peer can still read.                |
| Software rolled back to v1 under a v2 tail  | Sends v2 and fails. Accepted, see below.                 |
| Local AID has a v2 KEL, peer is v1          | Nothing readable can be sent. Refuse with a typed error. |

The rolled-back host cannot serve or verify its own v2 tail, so it is already broken
independent of this rule.

## Delivery

- The recipient's version selects the message body and its attachments.
- The mailbox provider's version selects the outer envelope and stream framing.
- A v2 message that would have to pass through a v1 provider is a typed failed outcome,
  never a silent send or downgrade.
- A body shared by several recipients uses the lowest version among them.

## Decisions

- `tufa incept` keeps its 2.0 default. Identifiers for v1 peers pass `--version 1.0`.
- A deliberate `--version 2.0` upgrade rotation is permitted. Under this rule it is how a
  v1 identifier moves up. Authoring otherwise keeps refusing an unrequested version change.
- No signed peer-version reply for now. A signed override can be added later if rollback or
  a v1 KEL on a v2-capable host becomes a real need. It would need [#830](https://github.com/kentbull/keri-ts/issues/830)
  to have shipped, because earlier keri-ts versions abort a stream on an unknown reply route.

## Implementation order

1. Fix #830, so one invalid message no longer aborts its stream.
2. Add the lookup and the Poster recipient and provider rules with the typed refusal.
3. Permit the upgrade rotation and add the compatibility inventory entry.

Producers need no lookup yet. A Hab already authors at its own KEL version, and a v2 peer reads
v1, so the only unsafe case is v2 output to a peer treated as v1, which Poster refuses. Witness
receipts keep their explicit flag or v1 default for the same reason.

## Tests

Reference-profile interop lanes keep v1 and v2 separate:

- v1 peer (`1.2`, `1.3`): default v1 end to end.
- Candidate peer with a v2 tail: v2.
- Mixed KEL from the candidate (v1 inception, v2 rotation): flips only after the rotation is accepted.
- Unknown peer and a stale local KEL: v1.
- v2 recipient behind a v1 mailbox: v1 envelope with a v1 body, v2 body refused.
- Upgrade rotation: a v1 identifier rotates to v2 and peers select v2 afterwards.
