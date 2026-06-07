---
"keri-ts": patch
"@keri-ts/tufa": patch
---

Add KLI-holder and mixed KLI/Tufa credential-chain interop support, including
bounded `tufa ipex poll` mailbox processing, KERIpy-compatible forwarded ACDC
support payload handling, bidirectional revocation propagation, and I2I/NI2I
mixed-chain verifier gates with a KERIpy IPEX message-length preflight for the
known local `serializeMessage` quadlet-alignment bug.
