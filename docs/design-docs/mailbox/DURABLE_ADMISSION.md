# Retired durable mailbox admission

The optional consumer inbox, delivery identities, acknowledgements, deadletters,
quotas and `mbin.` store have been removed under
[ADR-0013](../../adr/adr-0013-simple-component-flows.md).

Mailbox polling hands ordinary bytes to its consumer and records topic cursors.
Those cursors record transport progress, not verified application completion or
crash-safe delivery. Provider Mailboxer storage remains independent. See
[mailbox behavior](MAILBOX.md). No migration reader or compatibility mode remains.
