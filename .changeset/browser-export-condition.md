---
"keri-ts": minor
"cesr-ts": minor
---

Add a polyfill-free `browser` export condition to the browser-safe entrypoints (`cesr-ts`, and `keri-ts`, `keri-ts/runtime`, `keri-ts/db`, `keri-ts/db/indexeddb`) so bundlers no longer pull `node:module`, `node:url` and `node:path` through DNT's polyfill import. `import` and `types` targets are unchanged; the Node-only subpaths get no `browser` condition.
