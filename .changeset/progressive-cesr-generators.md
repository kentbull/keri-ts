---
"cesr-ts": minor
---

Add a pull-based async `parse` generator that emits complete GenericGroup children before the enclosing payload finishes. Move async frame adapters to this parser, preserve selected genus and exact child bounds, and close input on cancellation or failure. Async adapters now take resource limits and cancellation instead of the obsolete framed emission option.
