# Retired shared resource policy

Status: superseded by the 2026-10-15 removal decision in
[ADR-0013](../../adr/adr-0013-simple-component-flows.md). This document no longer supplies implementation or
release requirements. Git history preserves the prior accounting design.

Remove the shared policy, all reservations/credits/estimates and their cross-layer
plumbing. No parser, codec, domain, queue, storage, replay, runtime or CLI budget
may remain. A necessary private socket constraint requires production evidence;
native stream backpressure is preferred. Do not retain no-op compatibility APIs.

The migration is incomplete. Preserve real framing, cryptographic validation,
transactions and actual file/socket/iterator cleanup while deleting accounting.
Do not describe logical allowances as a process-memory guarantee.
