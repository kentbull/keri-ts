---
"keri-ts": patch
---

`importCredentialStream` accepts an exported disclosure stream: it now tracks v2 `rip`/`bup` registry events (accepted at their exact ordinal in the v2 registry store) and v2 Grants and Admits (accepted by the Exchanger, the Admit only once its Grant's reply row names it), and reports any it could not accept. The import dispatches its frames as retained history (the new `DispatchOptions.retained`), so a v2 exchange long past its KRAM window is accepted without KRAM; signatures, route verification and escrows are unchanged, and the accepted exchanges raise no notice and carry no exchange lifetime. Network intake cannot set it: byte sources and the Reactor take the new `IntakeOptions`, and ordinary intake still refuses the same stale exchanges.
