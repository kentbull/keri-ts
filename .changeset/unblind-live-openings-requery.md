---
"keri-ts": patch
"@keri-ts/tufa": patch
---

`Unblind.openings(xid)` returns the verified openings an authenticated Unblind reply selected (KERIpy kentbull/keripy#156). `Unblind.requery(xid)` and `Dhke.requery(xid)` re-sign a started individual query at send time without extending the Grant deadline (KERIpy #159). `tufa ipex unblind` now runs live `--grant` qry/rpy Unblind by default, as KERIpy does. Offline `--opening` candidate recovery is the explicit fallback.
