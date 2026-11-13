---
"keri-ts": patch
"cesr-ts": patch
"@keri-ts/wallet": patch
---

Constructing any `AppError`, `ValidationError` or other keri-ts error threw a `TypeError` in a browser bundle. `AppError` (and cesr-ts's `ParserError`) set their name from `new.target.name`, which the npm build rewrites into a call that needs `_dnt.polyfills.js`, and the browser entries never load it, so a routine error stopped the runtime that raised it. Every error class now names itself with a string literal, which also survives a minifier that mangles class names. The browser bundle gate now fails if anything a browser entry reaches contains the `import-meta-ponyfill` call.
