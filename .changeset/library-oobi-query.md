---
"keri-ts": minor
"tufa": minor
---

Add library OOBI resolution and query workflows to `keri-ts/runtime`: `resolveOobi`, `beginOobi` and `oobiStatus` report a resolution as resolved, failed (with the Oobiery's recorded reason) or timed out, and `queryKeyState`, `queryAnchor`, `beginKeyStateQuery`, `beginAnchorQuery` and `anchorQueryStatus` run the key-state and anchor queries. `tufa oobi resolve` and `tufa query` now call these functions with unchanged flags, output and errors.
