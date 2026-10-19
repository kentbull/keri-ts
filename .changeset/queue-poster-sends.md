---
"keri-ts": major
"@keri-ts/tufa": major
---

Route all Poster sends through its queue and independent deliverDo worker. Producers
publish signed source messages with send({ src, dest, topic, msg }) and optionally
request notification, then wait for the returned event's concrete sent/failed outcome.
HTTP and witness ingress publish delivery work without running the Poster worker.

Remove Poster.sendBytes, Poster.sendExchange, Poster.sendPreparedExchange,
ExchangeSendResult and RawCesrSendResult. Exchange construction moves to
createExchangeMessage in exchange-messaging; sendExchangeMessage uses the queued
worker and accepts dest instead of recipient. Standalone callers must run a Poster
worker when awaiting queued delivery. Existing cue cursor scheduling and exact-packet
retry remain unchanged until the next simplifying refactor.
