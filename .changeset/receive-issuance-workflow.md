---
"@keri-ts/wallet": patch
"keri-ts": minor
"@keri-ts/tufa": patch
---

keri-ts adds the holder's receive workflows to `keri-ts/runtime`. `admitAndDeliver(deps, input)` signs and accepts the Admit, runs the host's `onAdmitted` step once before delivery (a wallet records its consent in its inventory there), and delivers within a budget; a failed or expired delivery is a value (`delivery: { state: "undelivered", reason }`), and `deliver: false` leaves the bytes to the caller. `receiveIssuance(ops, input)` is the whole individual path for a pending Grant: approve the DH exchange, wait for the issuer, then `admitAndDeliver`, with the typed outcome `admitted | ended | timed-out`; calling it again after `timed-out` resumes. `@keri-ts/wallet`'s `credentials.receive` and `tufa ipex admit --acdc-v2` are thin callers of them with unchanged behavior, flags and output. `RegistryRoot` takes an optional `ChangeSink` and publishes `{ kind: "root", id: registry }` when it retains a root copy (new workflow kind `"root"`), so a host that waited for the root can act; the wallet's sink retries its tracked group-issuance recorders on it, so a member's inventory records a group issuance once the copy arrives.
