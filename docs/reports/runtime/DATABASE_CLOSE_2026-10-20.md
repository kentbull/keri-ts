# Database close contract and binding limits

Inspected pinned lmdb-js 3.5.3 (`read.js`, `write.js`, `src/env.cpp`) and
Effection 3.6.1 (`instructions.ts`, `run/frame.ts`, `run/task.ts`).

LMDBer now propagates observable close failures for ordinary and existing-only
handles. Shutdown makes its public `env` unavailable immediately. A rejected
close retains its failure and forbids reuse, reopening and directory removal;
no error-message classification or retry of an uncertain native handle occurs.
Confirmed closure permits harmless repeated close. Generic `openExisting` keeps
its refusal to create missing storage/tables or clear the environment.

## Binding evidence

Root `close()` sets status to closing, disables reads and writes, drains pending
writes, waits for outstanding reads in `doClose`, and invokes its callback after
setting status to closed. Its returned Promise can resolve before `doClose` on
the deferred-read branch. LMDBer therefore bridges that completion callback and
also observes Promise rejection. Cancellation joins the same pending close;
path removal follows completion, never elapsed time.

The old `quiesceEnvTimers()` one-millisecond delay is removed. Read renewal
schedules `resetReadTxn` at zero milliseconds, but close clears its active marker
and aborts the transaction. The scheduled callback then has no reset work. The
focused native tests pass with normal Deno sanitizers and without the delay.

**Limit:** `read.js` catches errors from read-transaction abort and native
`env.close()`; `_endWrites` also drains previously rejected write promises.
Native `mdb_env_close` returns void. Our wrapper cannot recover errors already
hidden by the binding or promise that its callback proves every native teardown
step succeeded. It does propagate every failure exposed by the binding, and
never infers that a rejected handle is closed or reusable. No unsafe direct
native-close bypass or dependency fork is introduced.

## Effection evidence and affected owners

Effection 3.6.1 does not aggregate an operation failure with child destruction
failure: `createFrame` selects destruction failure. A minimal local runtime probe
also found that a resource acquiring asynchronously before `provide()` can lose
its cleanup error under `call`, whereas the synchronous-acquisition case rejects.
Do not rely on that resource shape for final command success. PR 12d removes
the superseded OOBI resource opener and qualifies explicit Baser ownership,
completed/remaining row reporting and final shutdown-failure reporting.

The affected database factories and CLI ownership helpers explicitly preserve
operation plus cleanup failures in `AggregateError`, without a cleanup framework.
Habery attempts Baser, Keeper and owned Configer closure even if an earlier
close fails. A cleanup failure does not imply row rollback.

## Focused checks

Docker Linux arm64, Deno 2.8.2, pinned V1-format native LMDB: 78 tests passed in
`lmdber-lifecycle`, `cli-context`, `basing`, `habbing` and `essr`. Fault injection
uses the actual root handle's close boundary; real close/reopen/deletion checks
remain. Coverage includes ordinary/existing-only synchronous and asynchronous
close failures, known-closed repetition, no reopen/delete after failure, callback
completion, cancellation joining, acquisition/cleanup error identity, all owned
Habery closures, and existing authenticated ESSR/restart behavior. These are
scoped checks, not final release qualification.
