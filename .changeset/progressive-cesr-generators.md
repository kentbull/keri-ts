---
"cesr-ts": minor
"keri-ts": patch
---

Add a pull-based async `parse` generator that emits complete GenericGroup children before the enclosing payload finishes. Move async frame adapters to this parser, preserve selected genus and exact child bounds, and close input on cancellation or failure. Async adapters now take resource limits and cancellation instead of the obsolete framed emission option.

Expose the scope-owned Effection adapter through the optional `cesr-ts/effection` entrypoint and optional peer dependency, keeping the CESR root import framework-neutral. Remove the obsolete KERI convenience reexport; Effection callers use the explicit integration entrypoint.
