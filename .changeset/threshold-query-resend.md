---
"keri-ts": patch
---

A group's threshold DH and Unblind query, which one member cannot re-date, is no longer resent unchanged every second for the life of the operation. The group resends with a gap that doubles from 1 s to 8 s and stops once the query is older than the multi-key KRAM window, while the operation keeps waiting to its deadline. A receiver now treats a copy byte-identical to the query it already accepted as a duplicate: it is not verified again, adds no group `sign` contribution, and re-sends the stored reply at most once per second.
