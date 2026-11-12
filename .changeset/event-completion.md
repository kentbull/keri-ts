---
"keri-ts": minor
---

Add `receiptEvent`, `beginDelegation`, `delegationStatus`, `waitForDelegation` and `completeEvent` to `keri-ts/runtime`. They own the steps after authoring a single-signature event, witness receipting and delegation begin-and-wait, so library hosts such as a browser wallet need not reimplement what `tufa incept`, `rotate`, `interact` and `witness submit` do. The CLI commands now call them with unchanged behavior.
