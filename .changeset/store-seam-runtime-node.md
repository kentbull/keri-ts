---
"keri-ts": patch
"@keri-ts/tufa": patch
"@keri-ts/hosting": patch
---

Add the `keri-ts/runtime/node` entrypoint for host-only transport: `TCPMessenger`, `TCPStreamMessenger`, the `tcp-egress` and `socketBytes` helpers, `NodeHttpClient`, `nodeTcpDialer` and `fileBytes`. `keri-ts/runtime` no longer exports them, so it reaches neither `node:` modules nor the `Deno` global through its transport code; import them from `keri-ts/runtime/node` instead. `requireTcpDialer` and `TcpDialer` stay on `keri-ts/runtime`.
