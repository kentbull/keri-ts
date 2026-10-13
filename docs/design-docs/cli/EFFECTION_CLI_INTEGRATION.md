# Tufa CLI and Effection ownership

Tufa runs command operations inside Effection. The actual CLI uses Commander;
the earlier Cliffy/toOp sketch is not the implementation contract.

`packages/tufa/src/cli/cli.ts` has two phases: synchronously parse arguments into
a CommandSelection, then yield the selected CommandHandler operation. Command
registration selects work; it must not launch detached asynchronous processing.
Help/version exits and expected AppError reporting use CliExitError so the outer
runner preserves exit codes and avoids duplicate fatal-stack output.

Pure protocol/body builders remain ordinary functions. Operations are appropriate
for work that owns asynchronous reads, runtime scopes or resources. Choose the
narrowest existing-store scope (`withExistingHabery`, `withAgentRuntime`, or
`withHabAndAgentRuntime`); create-if-missing startup is a different operation.

Adapting a Promise does not cancel the underlying I/O. Use the existing abortable
leaf pattern where required: pass a signal, abort it when the scope exits, then
join cleanup. Register owning resources before work children so pending I/O stops
before payloads, database handles or admission credits are released.

The CLI/application package owns command registration, role hosts and transport
middleware; reusable domain operations may live in KERI. Test command selection,
error/exit behavior and real output pipes at the Tufa boundary. Packed Node smokes
remain necessary when package or host behavior changes.

See [runtime ingress/egress](../runtime/INGRESS_AND_EGRESS.md),
[package architecture](../../ARCHITECTURE_MAP.md) and
[ADR-0011](../../adr/adr-0011-three-package-architecture.md).
