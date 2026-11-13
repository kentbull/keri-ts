---
"keri-ts": patch
"cesr-ts": patch
---

A browser wallet under a strict Content-Security-Policy (`script-src 'self' 'wasm-unsafe-eval'`, no `'unsafe-eval'`) can now pin and validate schemas. Ajv compiled each schema with `new Function`, so `new Schemer` failed with "Invalid JSON Schema document." and Grant and Offer intake with it; the real `EvalError` was swallowed. Schema validation now interprets schemas with `@cfworker/json-schema` in every environment, with no code generation. It keeps what Ajv did here: `format` never rejects, schema documents are checked against their dialect's meta-schema (embedded as data), an invalid `pattern` fails when the schema is prepared, and the per-SAID prepared-validator cache is unchanged. The one new refusal is a schema using `$dynamicRef`, which the engine cannot interpret. "Invalid JSON Schema document." now carries the reason as its `cause`. cesr-ts takes cbor-x from its no-eval build, whose default build probes `new Function` at load, and the browser bundle gate now fails if any bundled code contains `new Function(` or a direct `eval(`.
