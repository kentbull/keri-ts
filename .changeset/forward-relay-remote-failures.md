---
"keri-ts": patch
---

A remote party can no longer end a mailbox-polling agent's runtime or a relaying host's Poster loop through `/fwd` forwarding.

Before, a legacy (v1) `/fwd` whose embedded event was not a message (for example `{"t":"zzz"}`) threw from `ForwardHandler.verify`, ending the mailbox poll and throwing again on every escrow retry. A `/fwd` whose embedded child was followed by attachment bytes that are not that child's attachments was accepted, then relayed, and threw out of the Poster's pass, ending `deliverDo`; stored or ingested, the same bytes reached the recipient. A `/fwd` topic too long to key a mailbox row threw the store's `DatabaseKeyError`, as did a raw exn whose route made such a topic on an agent that keeps mail for an edge. An accepted location with credentials (or a TCP location without a port) threw out of the Poster's pass too.

`ForwardHandler.verify` now refuses, as a typed reject, a `/fwd` whose recipient is not an identifier prefix, whose topic is empty or cannot key a mailbox row, or whose child (legacy embed or v2 nest) does not parse as exactly one complete message with its attachments; nothing is stored, relayed or ingested for it. The Poster decodes each event once: bytes that are not complete CESR, and an ordinary forwarded event that is not exactly one message, fail that event with the new `UnsendableMessageError`, and the loop continues. A location no messenger can use (`messengerUrl`, which applies `isRequestableHttpUrl`) is treated as no location, and a relay whose only location is such a URL reads as unresolved.

An agent keeping raw arrivals for an edge (`keepRawArrival`) no longer keeps a key event the agent escrowed out of order or as likely duplicitous (decided before it evaluated the event's keys), a message no processor decided other than a receipt, or a message whose topic cannot key a mailbox row.

New: `storableTopic`, `messengerUrl`, `UnsendableMessageError`. `messengerFrom` now refuses an unparseable URL with its `ValidationError` instead of a `TypeError`.
