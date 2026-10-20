# Runtime documentation coverage

Status: source review complete. Baseline `281fa5f7`; all 444 historical/supporting entries below are reviewed.

The ledger includes changed declarations plus complete transport/protocol owners.
A per-commit audit of every non-merge commit from `6c8e5971` through `281fa5f7`
found no additional surviving declaration outside this inventory. Each phase is owned
by the primary documentation pass. Expanded means comments changed at the declaration
or within its owned members; retained means the existing contract was reviewed and
kept. These labels describe review disposition, not automated prose-quality scores.
Complete-owner class rows include member fields; contextual Hab/Kevery/Tevery rows cover only the touched contract. Interface/type rows include field contracts.
Named local callbacks are reviewed with their enclosing function. Evidence names refer
to existing unit tests under `packages/keri/test/unit/app`, or the Tufa host tests.

## Phase 1

Evidence: http-client, cesr-egress, query-transport.

| Source / qualified symbol                                                         | Status             |
| --------------------------------------------------------------------------------- | ------------------ |
| `packages/keri/src/app/cesr-egress.ts` — `CesrHttpRefusal`                        | Reviewed; expanded |
| `packages/keri/src/app/cesr-egress.ts` — `CesrHttpRefusal.constructor`            | Reviewed; expanded |
| `packages/keri/src/app/cesr-egress.ts` — `CesrPostResult`                         | Reviewed; expanded |
| `packages/keri/src/app/cesr-egress.ts` — `FrameResponse`                          | Reviewed; expanded |
| `packages/keri/src/app/cesr-egress.ts` — `EgressOptions`                          | Reviewed; expanded |
| `packages/keri/src/app/cesr-egress.ts` — `readResponseBody`                       | Reviewed; expanded |
| `packages/keri/src/app/cesr-egress.ts` — `requestFrame`                           | Reviewed; expanded |
| `packages/keri/src/app/cesr-egress.ts` — `openFrameResponse`                      | Reviewed; expanded |
| `packages/keri/src/app/cesr-egress.ts` — `frameRequests`                          | Reviewed; expanded |
| `packages/keri/src/app/cesr-egress.ts` — `mediaRejection`                         | Reviewed; expanded |
| `packages/keri/src/app/cesr-egress.ts` — `sendFrame`                              | Reviewed; expanded |
| `packages/keri/src/app/cesr-egress.ts` — `postCesr`                               | Reviewed; expanded |
| `packages/keri/src/app/cesr-egress.ts` — `attemptPostCesr`                        | Reviewed; expanded |
| `packages/keri/src/app/http-client.ts` — `HttpRequestInit`                        | Reviewed; retained |
| `packages/keri/src/app/http-client.ts` — `HttpResponse`                           | Reviewed; retained |
| `packages/keri/src/app/http-client.ts` — `HttpStreamResponse`                     | Reviewed; expanded |
| `packages/keri/src/app/http-client.ts` — `HttpClient`                             | Reviewed; expanded |
| `packages/keri/src/app/http-client.ts` — `FetchHttpClient`                        | Reviewed; expanded |
| `packages/keri/src/app/http-client.ts` — `FetchHttpClient.request`                | Reviewed; expanded |
| `packages/keri/src/app/http-client.ts` — `FetchHttpClient.open`                   | Reviewed; expanded |
| `packages/keri/src/app/http-client.ts` — `FetchHttpClient.body`                   | Reviewed; expanded |
| `packages/keri/src/app/http-client.ts` — `FetchHttpClient.[Symbol.asyncIterator]` | Reviewed; retained |
| `packages/keri/src/app/http-messenger.ts` — `HTTPMessengerOptions`                | Reviewed; retained |
| `packages/keri/src/app/http-messenger.ts` — `HTTPMessenger`                       | Reviewed; expanded |
| `packages/keri/src/app/http-messenger.ts` — `HTTPMessenger.constructor`           | Reviewed; expanded |
| `packages/keri/src/app/http-messenger.ts` — `HTTPMessenger.send`                  | Reviewed; expanded |
| `packages/keri/src/app/http-messenger.ts` — `HTTPMessenger.stream`                | Reviewed; expanded |
| `packages/keri/src/app/http-messenger.ts` — `HTTPMessenger.query`                 | Reviewed; expanded |
| `packages/keri/src/app/message-source.ts` — `IngressOptions`                      | Reviewed; retained |
| `packages/keri/src/app/message-source.ts` — `processMessages`                     | Reviewed; expanded |
| `packages/keri/src/app/transport-error.ts` — `TransportError`                     | Reviewed; expanded |
| `packages/keri/src/app/transport-error.ts` — `TransportError.constructor`         | Reviewed; expanded |
| `packages/keri/src/app/abortable.ts` — `remainingFailures`                        | Reviewed; expanded |
| `packages/keri/src/app/abortable.ts` — `rethrowCleanupFailure`                    | Reviewed; expanded |
| `packages/keri/src/app/abortable.ts` — `abortable`                                | Reviewed; expanded |
| `packages/keri/src/app/byte-source.ts` — `SourceOptions`                          | Reviewed; retained |
| `packages/keri/src/app/byte-source.ts` — `chunkBytes`                             | Reviewed; expanded |
| `packages/keri/src/app/byte-source.ts` — `streamBytes`                            | Reviewed; expanded |
| `packages/keri/src/app/byte-source.ts` — `fileBytes`                              | Reviewed; expanded |
| `packages/keri/src/app/byte-source.ts` — `collectBytes`                           | Reviewed; expanded |
| `packages/keri/src/app/byte-source.ts` — `checkLimit`                             | Reviewed; expanded |

## Phase 2

Evidence: witness-transport, query-transport; Tufa progressive-ingress.

| Source / qualified symbol                                             | Status             |
| --------------------------------------------------------------------- | ------------------ |
| `packages/keri/src/app/tcp-egress.ts` — `TcpSendOptions`              | Reviewed; expanded |
| `packages/keri/src/app/tcp-egress.ts` — `TcpSourceFactory`            | Reviewed; retained |
| `packages/keri/src/app/tcp-egress.ts` — `TcpTransmission`             | Reviewed; expanded |
| `packages/keri/src/app/tcp-egress.ts` — `TcpConnection`               | Reviewed; expanded |
| `packages/keri/src/app/tcp-egress.ts` — `positive`                    | Reviewed; expanded |
| `packages/keri/src/app/tcp-egress.ts` — `openTcpConnection`           | Reviewed; expanded |
| `packages/keri/src/app/tcp-egress.ts` — `sendCesrTcp`                 | Reviewed; expanded |
| `packages/keri/src/app/tcp-egress.ts` — `streamCesrTcp`               | Reviewed; expanded |
| `packages/keri/src/app/tcp-egress.ts` — `sendCesrTcpFrame`            | Reviewed; expanded |
| `packages/keri/src/app/tcp-egress.ts` — `TcpSocketWriteOptions`       | Reviewed; expanded |
| `packages/keri/src/app/tcp-egress.ts` — `writeCesrTcpSocket`          | Reviewed; expanded |
| `packages/keri/src/app/tcp-egress.ts` — `sendCesrTcpSocket`           | Reviewed; expanded |
| `packages/keri/src/app/tcp-egress.ts` — `finishTcpOutput`             | Reviewed; expanded |
| `packages/keri/src/app/tcp-egress.ts` — `eof`                         | Reviewed; expanded |
| `packages/keri/src/app/tcp-egress.ts` — `interrupted`                 | Reviewed; expanded |
| `packages/keri/src/app/tcp-egress.ts` — `writeBorrowedSource`         | Reviewed; expanded |
| `packages/keri/src/app/tcp-messenger.ts` — `TCPMessengerOptions`      | Reviewed; retained |
| `packages/keri/src/app/tcp-messenger.ts` — `TCPConversation`          | Reviewed; retained |
| `packages/keri/src/app/tcp-messenger.ts` — `TCPMessengerResult`       | Reviewed; retained |
| `packages/keri/src/app/tcp-messenger.ts` — `TCPMessenger`             | Reviewed; expanded |
| `packages/keri/src/app/tcp-messenger.ts` — `TCPMessenger.constructor` | Reviewed; expanded |
| `packages/keri/src/app/tcp-messenger.ts` — `TCPMessenger.send`        | Reviewed; expanded |
| `packages/keri/src/app/tcp-messenger.ts` — `TCPMessenger.stream`      | Reviewed; expanded |
| `packages/keri/src/app/tcp-messenger.ts` — `TCPMessenger.converse`    | Reviewed; expanded |
| `packages/tufa/src/host/witness-tcp.ts` — `WitnessTcpOptions`         | Reviewed; retained |
| `packages/tufa/src/host/witness-tcp.ts` — `isPeerError`               | Reviewed; expanded |
| `packages/tufa/src/host/witness-tcp.ts` — `processWitnessSocket`      | Reviewed; expanded |
| `packages/tufa/src/host/witness-tcp.ts` — `[Symbol.asyncIterator]`    | Reviewed; expanded |
| `packages/tufa/src/host/witness-tcp.ts` — `return`                    | Reviewed; expanded |
| `packages/tufa/src/host/witness-tcp.ts` — `witnessTcpListener`        | Reviewed; expanded |
| `packages/tufa/src/host/witness-tcp.ts` — `startWitnessTcpServer`     | Reviewed; expanded |
| `packages/keri/src/app/socket-source.ts` — `SocketSourceOptions`      | Reviewed; expanded |
| `packages/keri/src/app/socket-source.ts` — `socketBytes`              | Reviewed; expanded |
| `packages/keri/src/app/socket-source.ts` — `next`                     | Reviewed; expanded |
| `packages/keri/src/app/socket-source.ts` — `return`                   | Reviewed; expanded |
| `packages/keri/src/app/socket-source.ts` — `[Symbol.asyncIterator]`   | Reviewed; expanded |

## Phase 3

Evidence: poster-queue, runtime-responder, query-replies, reactor-turn, cue-runtime.

| Source / qualified symbol                                                               | Status                 |
| --------------------------------------------------------------------------------------- | ---------------------- |
| `packages/keri/src/app/forwarding.ts` — `ExchangeDeliveryPreference`                    | Reviewed; retained     |
| `packages/keri/src/app/forwarding.ts` — `PosterEvent`                                   | Reviewed; expanded     |
| `packages/keri/src/app/forwarding.ts` — `PosterOutcome`                                 | Reviewed; expanded     |
| `packages/keri/src/app/forwarding.ts` — `RawCesrRoute`                                  | Reviewed; expanded     |
| `packages/keri/src/app/forwarding.ts` — `PreparedCesrTarget`                            | Reviewed; expanded     |
| `packages/keri/src/app/forwarding.ts` — `remoteCesrTarget`                              | Reviewed; expanded     |
| `packages/keri/src/app/forwarding.ts` — `MailboxPollerOptions`                          | Reviewed; expanded     |
| `packages/keri/src/app/forwarding.ts` — `Poster`                                        | Reviewed; expanded     |
| `packages/keri/src/app/forwarding.ts` — `Poster.constructor`                            | Reviewed; expanded     |
| `packages/keri/src/app/forwarding.ts` — `Poster.send`                                   | Reviewed; expanded     |
| `packages/keri/src/app/forwarding.ts` — `Poster.sendAll`                                | Reviewed; expanded     |
| `packages/keri/src/app/forwarding.ts` — `Poster.retry`                                  | Reviewed; expanded     |
| `packages/keri/src/app/forwarding.ts` — `Poster.discard`                                | Reviewed; expanded     |
| `packages/keri/src/app/forwarding.ts` — `Poster.wait`                                   | Reviewed; expanded     |
| `packages/keri/src/app/forwarding.ts` — `Poster.takeOutcome`                            | Reviewed; expanded     |
| `packages/keri/src/app/forwarding.ts` — `Poster.deliverDo`                              | Reviewed; retained     |
| `packages/keri/src/app/forwarding.ts` — `Poster.hasPending`                             | Reviewed; retained     |
| `packages/keri/src/app/forwarding.ts` — `Poster.ensureOpen`                             | Reviewed; retained     |
| `packages/keri/src/app/forwarding.ts` — `Poster.close`                                  | Reviewed; retained     |
| `packages/keri/src/app/forwarding.ts` — `Poster.process`                                | Reviewed; retained     |
| `packages/keri/src/app/forwarding.ts` — `Poster.finish`                                 | Reviewed; expanded     |
| `packages/keri/src/app/forwarding.ts` — `Poster.resolveRecipient`                       | Reviewed; expanded     |
| `packages/keri/src/app/forwarding.ts` — `Poster.deliverEvent`                           | Reviewed; expanded     |
| `packages/keri/src/app/forwarding.ts` — `Poster.canDeliver`                             | Reviewed; expanded     |
| `packages/keri/src/app/forwarding.ts` — `Poster.resolveBytesRoute`                      | Reviewed; expanded     |
| `packages/keri/src/app/forwarding.ts` — `Poster.findBytesRoute`                         | Reviewed; expanded     |
| `packages/keri/src/app/forwarding.ts` — `Poster.prepareBytesTarget`                     | Reviewed; expanded     |
| `packages/keri/src/app/forwarding.ts` — `Poster.prepareForwardedTarget`                 | Reviewed; expanded     |
| `packages/keri/src/app/forwarding.ts` — `Poster.requireMbx`                             | Reviewed; expanded     |
| `packages/keri/src/app/forwarding.ts` — `ForwardHandler`                                | Reviewed; expanded     |
| `packages/keri/src/app/forwarding.ts` — `ForwardHandler.constructor`                    | Reviewed; expanded     |
| `packages/keri/src/app/forwarding.ts` — `ForwardHandler.verify`                         | Reviewed; expanded     |
| `packages/keri/src/app/forwarding.ts` — `ForwardHandler.handle`                         | Reviewed; expanded     |
| `packages/keri/src/app/forwarding.ts` — `hostCanStoreForwardRecipient`                  | Reviewed; expanded     |
| `packages/keri/src/app/forwarding.ts` — `hasLocalStoreForwardHost`                      | Reviewed; expanded     |
| `packages/keri/src/app/habbing.ts` — `Hab`                                              | Reviewed; expanded     |
| `packages/keri/src/app/habbing.ts` — `Hab.processCuesIter`                              | Reviewed; expanded     |
| `packages/keri/src/app/parsering.ts` — `dispatchEnvelope`                               | Reviewed; expanded     |
| `packages/keri/src/app/protocol-processing.ts` — `DispatchOptions`                      | Reviewed; retained     |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolDispatchResult`               | Reviewed; retained     |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolProcessor`                    | Reviewed; expanded     |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolProcessor.constructor`        | Reviewed; expanded     |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolProcessor.makeKevery`         | Reviewed; expanded     |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolProcessor.dispatch`           | Reviewed; expanded     |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolProcessor.publishCues`        | Reviewed; retained     |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolProcessor.acquireProtocol`    | Reviewed; expanded     |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolProcessor.processEscrowsOnce` | Reviewed; expanded     |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolProcessor.advanceEscrows`     | Reviewed; retained     |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolProcessor.escrowDo`           | Reviewed; retained     |
| `packages/keri/src/app/protocol-processing.ts` — `createProtocolProcessor`              | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `copyQuery`                                       | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `QueryContinuation`                               | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `soleHab`                                         | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `parseHexOrdinal`                                 | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `encodeHexOrdinal`                                | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `KeyStateNoticer`                                 | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `KeyStateNoticer.constructor`                     | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `KeyStateNoticer.observe`                         | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `KeyStateNoticer.tick`                            | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `LogQuerier`                                      | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `LogQuerier.constructor`                          | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `LogQuerier.observe`                              | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `LogQuerier.tick`                                 | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `SeqNoQuerier`                                    | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `SeqNoQuerier.constructor`                        | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `SeqNoQuerier.observe`                            | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `SeqNoQuerier.tick`                               | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `AnchorQuerier`                                   | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `AnchorQuerier.constructor`                       | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `AnchorQuerier.observe`                           | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `AnchorQuerier.tick`                              | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `resolveQueryDestinationUrl`                      | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `QueryDelivery`                                   | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator`                                | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.pending`                        | Reviewed; retained     |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.constructor`                    | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.configure`                      | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.watchKeyState`                  | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.watchSeqNo`                     | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.watchAnchor`                    | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.hasPendingWork`                 | Reviewed; retained     |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.enqueue`                        | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.enqueueCue`                     | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.hasPendingDelivery`             | Reviewed; retained     |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.deliverOnce`                    | Reviewed; retained     |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.postQueryMessage`               | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.processPending`                 | Reviewed; retained     |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.close`                          | Reviewed; retained     |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.queryDo`                        | Reviewed; retained     |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.configuredHab`                  | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.observeCue`                     | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.tickContinuations`              | Reviewed; retained     |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.compactContinuations`           | Reviewed; retained     |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.prepareRequest`                 | Reviewed; expanded     |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.attestersFor`                   | Reviewed; expanded     |
| `packages/keri/src/app/reactor.ts` — `Reactor`                                          | Reviewed; expanded     |
| `packages/keri/src/app/reactor.ts` — `Reactor.constructor`                              | Reviewed; expanded     |
| `packages/keri/src/app/reactor.ts` — `Reactor.hasIngress`                               | Retired; awaited input |
| `packages/keri/src/app/reactor.ts` — `Reactor.process`                                  | Reviewed; expanded     |
| `packages/keri/src/app/reactor.ts` — `Reactor.ingest`                                   | Retired; awaited input |
| `packages/keri/src/app/reactor.ts` — `Reactor.clearIngress`                             | Retired; awaited input |
| `packages/keri/src/app/reactor.ts` — `Reactor.processBytes`                             | Reviewed; expanded     |
| `packages/keri/src/app/reactor.ts` — `Reactor.processOnce`                              | Retired; awaited input |
| `packages/keri/src/app/reactor.ts` — `Reactor.msgDo`                                    | Retired; awaited input |
| `packages/keri/src/app/respondant.ts` — `Respondant`                                    | Reviewed; expanded     |
| `packages/keri/src/app/respondant.ts` — `Respondant.constructor`                        | Reviewed; expanded     |
| `packages/keri/src/app/respondant.ts` — `Respondant.enqueueCue`                         | Reviewed; expanded     |
| `packages/keri/src/app/respondant.ts` — `Respondant.enqueueMsgs`                        | Reviewed; expanded     |
| `packages/keri/src/app/respondant.ts` — `Respondant.openReply`                          | Reviewed; expanded     |
| `packages/keri/src/app/respondant.ts` — `Respondant.enqueueReply`                       | Reviewed; expanded     |
| `packages/keri/src/app/respondant.ts` — `Respondant.prepareReplies`                     | Reviewed; expanded     |
| `packages/keri/src/app/respondant.ts` — `topicForCue`                                   | Reviewed; expanded     |
| `packages/keri/src/app/respondant.ts` — `recipientForCue`                               | Reviewed; expanded     |
| `packages/keri/src/app/respondant.ts` — `senderHabForCue`                               | Reviewed; expanded     |
| `packages/keri/src/app/respondant.ts` — `cueSourcePrefix`                               | Reviewed; expanded     |
| `packages/keri/src/app/respondant.ts` — `soleHab`                                       | Reviewed; expanded     |
| `packages/keri/src/core/cues.ts` — `ReplayCue`                                          | Reviewed; expanded     |
| `packages/keri/src/core/eventing.ts` — `Kevery`                                         | Reviewed; expanded     |
| `packages/keri/src/core/eventing.ts` — `Kevery.decideQuery`                             | Reviewed; expanded     |
| `packages/keri/src/vdr/eventing.ts` — `Tevery`                                          | Reviewed; expanded     |
| `packages/keri/src/vdr/eventing.ts` — `Tevery.processQuery`                             | Reviewed; expanded     |
| `packages/keri/src/app/query-replies.ts` — `DirectReply`                                | Reviewed; retained     |
| `packages/keri/src/app/query-replies.ts` — `Slot`                                       | Reviewed; expanded     |
| `packages/keri/src/app/query-replies.ts` — `QueryReplyBatch`                            | Reviewed; expanded     |
| `packages/keri/src/app/query-replies.ts` — `QueryReply`                                 | Reviewed; expanded     |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies`                               | Reviewed; expanded     |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies.constructor`                   | Reviewed; expanded     |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies.reserve`                       | Reviewed; expanded     |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies.reserveEvent`                  | Reviewed; expanded     |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies.reserveKey`                    | Reviewed; expanded     |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies.ready`                         | Reviewed; expanded     |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies.observeReady`                  | Reviewed; expanded     |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies.peekAll`                       | Reviewed; expanded     |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies.takeAll`                       | Reviewed; expanded     |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies.capture`                       | Reviewed; expanded     |
| `packages/keri/src/app/reply-streams.ts` — `ReplyStreams`                               | Reviewed; expanded     |
| `packages/keri/src/app/reply-streams.ts` — `ReplyStreams.open`                          | Reviewed; expanded     |
| `packages/keri/src/app/reply-streams.ts` — `ReplyStreams.openNonEmpty`                  | Reviewed; expanded     |
| `packages/keri/src/app/reply-streams.ts` — `ReplyStreams.openChecked`                   | Reviewed; expanded     |
| `packages/keri/src/app/reply-streams.ts` — `ReplyStreams.openOwned`                     | Reviewed; expanded     |
| `packages/keri/src/app/reply-streams.ts` — `ReplyStreams.start`                         | Reviewed; expanded     |
| `packages/keri/src/app/reply-streams.ts` — `ReplyStreams.close`                         | Reviewed; retained     |
| `packages/keri/src/app/cue-runtime.ts` — `resolveCueHab`                                | Reviewed; expanded     |
| `packages/keri/src/app/cue-runtime.ts` — `processCuesOnce`                              | Reviewed; expanded     |
| `packages/keri/src/app/cue-runtime.ts` — `cueDo`                                        | Reviewed; expanded     |

## Phase 4

Evidence: mailbox-director-lifecycle, mailbox-poller-runtime, runtime-store-ownership, verifier-agent; CLI/workflow tests.

| Source / qualified symbol                                                                           | Status                       |
| --------------------------------------------------------------------------------------------------- | ---------------------------- |
| `packages/keri/src/app/agent-runtime.ts` — `AgentRuntime`                                           | Reviewed; retained           |
| `packages/keri/src/app/agent-runtime.ts` — `AgentRuntimeOptions`                                    | Reviewed; expanded           |
| `packages/keri/src/app/agent-runtime.ts` — `RuntimePendingState`                                    | Reviewed; expanded           |
| `packages/keri/src/app/agent-runtime.ts` — `RuntimeOobiTerminalState`                               | Reviewed; expanded           |
| `packages/keri/src/app/agent-runtime.ts` — `createAgentRuntime`                                     | Reviewed; expanded           |
| `packages/keri/src/app/agent-runtime.ts` — `close`                                                  | Reviewed; expanded           |
| `packages/keri/src/app/agent-runtime.ts` — `openRuntimeNoter`                                       | Reviewed; expanded           |
| `packages/keri/src/app/agent-runtime.ts` — `openRuntimeMailboxer`                                   | Reviewed; expanded           |
| `packages/keri/src/app/agent-runtime.ts` — `openAcdcRegeryForHabery`                                | Reviewed; expanded           |
| `packages/keri/src/app/agent-runtime.ts` — `openRegerForHabery`                                     | Reviewed; expanded           |
| `packages/keri/src/app/agent-runtime.ts` — `ingestKeriBytes`                                        | Retired; awaited input       |
| `packages/keri/src/app/agent-runtime.ts` — `enqueueOobi`                                            | Reviewed; expanded           |
| `packages/keri/src/app/agent-runtime.ts` — `settleRuntimeIngress`                                   | Reviewed; expanded           |
| `packages/keri/src/app/agent-runtime.ts` — `settleMailboxPollBatch`                                 | Reviewed; expanded           |
| `packages/keri/src/app/agent-runtime.ts` — `runtimePendingState`                                    | Reviewed; expanded           |
| `packages/keri/src/app/agent-runtime.ts` — `runtimeHasPendingWork`                                  | Reviewed; expanded           |
| `packages/keri/src/app/agent-runtime.ts` — `runtimeHasWellKnownAuth`                                | Reviewed; expanded           |
| `packages/keri/src/app/agent-runtime.ts` — `runtimeOobiTerminalState`                               | Reviewed; expanded           |
| `packages/keri/src/app/agent-runtime.ts` — `runtimeOobiConverged`                                   | Reviewed; expanded           |
| `packages/keri/src/app/agent-runtime.ts` — `runAgentRuntimeUntil`                                   | Reviewed; expanded           |
| `packages/keri/src/app/agent-runtime.ts` — `runAgentRuntime`                                        | Reviewed; expanded           |
| `packages/keri/src/app/authenticating.ts` — `Authenticator`                                         | Reviewed; expanded           |
| `packages/keri/src/app/authenticating.ts` — `Authenticator.constructor`                             | Reviewed; expanded           |
| `packages/keri/src/app/authenticating.ts` — `Authenticator.processPendingAuth`                      | Reviewed; expanded           |
| `packages/keri/src/app/cli/challenge.ts` — `challengeRespondCommand`                                | Reviewed; expanded           |
| `packages/keri/src/app/cli/common/context.ts` — `withAgentRuntime`                                  | Reviewed; expanded           |
| `packages/keri/src/app/cli/delegate.ts` — `publishGroupDelegationApproval`                          | Reviewed; expanded           |
| `packages/keri/src/app/cli/delegate.ts` — `performDelegationApproval`                               | Reviewed; expanded           |
| `packages/keri/src/app/cli/did.ts` — `dwsResolveCommand`                                            | Reviewed; expanded           |
| `packages/keri/src/app/cli/did.ts` — `receiptNewWitnessEvents`                                      | Reviewed; expanded           |
| `packages/keri/src/app/cli/ends.ts` — `endsAddCommand`                                              | Reviewed; expanded           |
| `packages/keri/src/app/cli/exchange.ts` — `exchangeSendCommand`                                     | Reviewed; expanded           |
| `packages/keri/src/app/cli/incept.ts` — `inceptCommand`                                             | Reviewed; expanded           |
| `packages/keri/src/app/cli/init.ts` — `initCommand`                                                 | Reviewed; expanded           |
| `packages/keri/src/app/cli/interact.ts` — `interactCommand`                                         | Reviewed; expanded           |
| `packages/keri/src/app/cli/ipex.ts` — `ipexApplyCommand`                                            | Reviewed; expanded           |
| `packages/keri/src/app/cli/ipex.ts` — `ipexOfferCommand`                                            | Reviewed; expanded           |
| `packages/keri/src/app/cli/ipex.ts` — `ipexGrantCommand`                                            | Reviewed; expanded           |
| `packages/keri/src/app/cli/ipex.ts` — `ipexAdmitCommand`                                            | Reviewed; expanded           |
| `packages/keri/src/app/cli/ipex.ts` — `ipexJoinCommand`                                             | Reviewed; expanded           |
| `packages/keri/src/app/cli/ipex.ts` — `sendPriorResponse`                                           | Reviewed; expanded           |
| `packages/keri/src/app/cli/ipex.ts` — `waitForMultisigIpexCompletion`                               | Reviewed; expanded           |
| `packages/keri/src/app/cli/multisig.ts` — `receiptAcceptedEvent`                                    | Reviewed; expanded           |
| `packages/keri/src/app/cli/oobi.ts` — `oobiRequestCommand`                                          | Reviewed; expanded           |
| `packages/keri/src/app/cli/rotate.ts` — `rotateCommand`                                             | Reviewed; expanded           |
| `packages/keri/src/app/cli/vc.ts` — `vcRegistryInceptCommand`                                       | Reviewed; expanded           |
| `packages/keri/src/app/cli/vc.ts` — `vcCreateCommand`                                               | Reviewed; expanded           |
| `packages/keri/src/app/cli/vc.ts` — `vcRevokeCommand`                                               | Reviewed; expanded           |
| `packages/keri/src/app/cli/verifier.ts` — `verifierRunCommand`                                      | Reviewed; expanded           |
| `packages/keri/src/app/credential-workflows.ts` — `inceptCredentialRegistry`                        | Reviewed; expanded           |
| `packages/keri/src/app/credential-workflows.ts` — `createCredential`                                | Reviewed; expanded           |
| `packages/keri/src/app/credential-workflows.ts` — `importCredentialStream`                          | Reviewed; expanded           |
| `packages/keri/src/app/credential-workflows.ts` — `revokeCredential`                                | Reviewed; expanded           |
| `packages/keri/src/app/credential-workflows.ts` — `proposeGroupRegistryIncept`                      | Reviewed; expanded           |
| `packages/keri/src/app/credential-workflows.ts` — `proposeGroupCredentialIssue`                     | Reviewed; expanded           |
| `packages/keri/src/app/credential-workflows.ts` — `publishGroupVcProposal`                          | Reviewed; expanded           |
| `packages/keri/src/app/delegating.ts` — `Anchorer`                                                  | Reviewed; expanded           |
| `packages/keri/src/app/delegating.ts` — `Anchorer.constructor`                                      | Reviewed; expanded           |
| `packages/keri/src/app/delegating.ts` — `Anchorer.begin`                                            | Reviewed; expanded           |
| `packages/keri/src/app/delegating.ts` — `Anchorer.processAllOnce`                                   | Reviewed; retained           |
| `packages/keri/src/app/delegating.ts` — `Anchorer.processPartialWitnessEscrow`                      | Reviewed; expanded           |
| `packages/keri/src/app/delegating.ts` — `Anchorer.publishDelegator`                                 | Reviewed; expanded           |
| `packages/keri/src/app/endpoint-roleing.ts` — `proposeGroupEndpointRole`                            | Reviewed; expanded           |
| `packages/keri/src/app/exchange-messaging.ts` — `ExchangeMessageArgs`                               | Reviewed; expanded           |
| `packages/keri/src/app/exchange-messaging.ts` — `createExchangeMessage`                             | Reviewed; expanded           |
| `packages/keri/src/app/exchange-messaging.ts` — `sendExchangeMessage`                               | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller`                                             | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.constructor`                                 | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.registerTopic`                               | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.pollDo`                                      | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.readLocalMailbox`                            | Retired by #556              |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.localCursor`                                 | Retired by #554              |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.pollRemoteEndpointOnce`                      | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.syncRemoteWorkers`                           | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.remoteEndpointWorker`                        | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.remotePollTargets`                           | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.pollSignerHab`                               | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `MailboxPollTarget`                                         | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `buildForwardedDelivery`                                    | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `mailboxReplyPayload`                                       | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `introductionMessages`                                      | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `[Symbol.iterator]`                                         | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `introduce`                                                 | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `remoteAlreadyReceiptedLatestEvent`                         | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `defaultTopicForRoute`                                      | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `pollMailboxTopic`                                          | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `transportMailboxTopic`                                     | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `mailboxTopicForRoute`                                      | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `extractForwardedMessage`                                   | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `embeddedSerderRaw`                                         | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `forwardedAttachmentForPath`                                | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `MailboxPollingTimeoutPolicy`                               | Reviewed; retained           |
| `packages/keri/src/app/forwarding.ts` — `MailboxPollBatch`                                          | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `MailboxFetchTimeoutPolicy`                                 | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `MailboxPollTransportRequest`                               | Retired; concrete HTTP owner |
| `packages/keri/src/app/forwarding.ts` — `MailboxPollTransport`                                      | Retired; concrete HTTP owner |
| `packages/keri/src/app/forwarding.ts` — `poll`                                                      | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `fetchMailboxMessages`                                      | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `fetchMailboxQueryResponse`                                 | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `normalizeMailboxPollingTimeoutPolicy`                      | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `mailboxFetchTimeoutPolicy`                                 | Reviewed; expanded           |
| `packages/keri/src/app/forwarding.ts` — `positiveTimeoutMs`                                         | Reviewed; expanded           |
| `packages/keri/src/app/httping.ts` — `requestWithHeaderTimeout`                                     | Reviewed; expanded           |
| `packages/keri/src/app/ipex-credentialing.ts` — `processCredentialPresentationArtifacts`            | Reviewed; expanded           |
| `packages/keri/src/app/ipex-grouping.ts` — `approveMultisigIpex`                                    | Reviewed; expanded           |
| `packages/keri/src/app/ipex-grouping.ts` — `publishGroupIpexProposal`                               | Reviewed; expanded           |
| `packages/keri/src/app/ipex-grouping.ts` — `findPendingMultisigIpex`                                | Reviewed; expanded           |
| `packages/keri/src/app/ipex-grouping.ts` — `sendCompletedGroupIpex`                                 | Reviewed; expanded           |
| `packages/keri/src/app/ipex-grouping.ts` — `sendCredentialBytes`                                    | Reviewed; expanded           |
| `packages/keri/src/app/mailbox-sse.ts` — `MailboxSseMessage`                                        | Reviewed; expanded           |
| `packages/keri/src/app/mailbox-sse.ts` — `MailboxSseOptions`                                        | Reviewed; retained           |
| `packages/keri/src/app/mailbox-sse.ts` — `eventMessage`                                             | Reviewed; expanded           |
| `packages/keri/src/app/mailbox-sse.ts` — `appendBytes`                                              | Reviewed; expanded           |
| `packages/keri/src/app/mailbox-sse.ts` — `consumeMailboxSse`                                        | Reviewed; expanded           |
| `packages/keri/src/app/mailbox-sse.ts` — `readMailboxSseBody`                                       | Reviewed; expanded           |
| `packages/keri/src/app/mailbox-sse.ts` — `parseMailboxSse`                                          | Reviewed; expanded           |
| `packages/keri/src/app/mailbox-sse.ts` — `consumeChunks`                                            | Reviewed; expanded           |
| `packages/keri/src/app/multisig-workflows.ts` — `publishProposal`                                   | Reviewed; expanded           |
| `packages/keri/src/app/multisig-workflows.ts` — `publishVdrProposal`                                | Reviewed; expanded           |
| `packages/keri/src/app/multisig-workflows.ts` — `registerAndSendProposal`                           | Reviewed; expanded           |
| `packages/keri/src/app/multisig-workflows.ts` — `approveRpyProposal`                                | Reviewed; expanded           |
| `packages/keri/src/app/multisig-workflows.ts` — `approveKelProposal`                                | Reviewed; expanded           |
| `packages/keri/src/app/multisig-workflows.ts` — `approveVdrProposal`                                | Reviewed; expanded           |
| `packages/keri/src/app/oobiery.ts` — `Oobiery`                                                      | Reviewed; expanded           |
| `packages/keri/src/app/oobiery.ts` — `Oobiery.constructor`                                          | Reviewed; expanded           |
| `packages/keri/src/app/oobiery.ts` — `Oobiery.registerReplyRoutes`                                  | Reviewed; expanded           |
| `packages/keri/src/app/oobiery.ts` — `Oobiery.processJob`                                           | Reviewed; expanded           |
| `packages/keri/src/app/oobiery.ts` — `Oobiery.processResponse`                                      | Reviewed; expanded           |
| `packages/keri/src/app/oobiery.ts` — `Oobiery.resolveCesrOobiResponse`                              | Reviewed; expanded           |
| `packages/keri/src/app/oobiery.ts` — `Oobiery.processReply`                                         | Reviewed; expanded           |
| `packages/keri/src/app/oobiery.ts` — `readResponseBytes`                                            | Reviewed; expanded           |
| `packages/keri/src/app/runtime-clock.ts` — `RuntimeTimer`                                           | Reviewed; retained           |
| `packages/keri/src/app/runtime-clock.ts` — `RuntimeClock`                                           | Reviewed; expanded           |
| `packages/keri/src/app/verifier-agent.ts` — `VerifierAgentOptions`                                  | Reviewed; expanded           |
| `packages/keri/src/app/verifier-agent.ts` — `VerifierAgent`                                         | Reviewed; expanded           |
| `packages/keri/src/app/verifier-agent.ts` — `VerifierAgent.constructor`                             | Reviewed; expanded           |
| `packages/keri/src/app/verifier-agent.ts` — `VerifierAgent.processOnce`                             | Reviewed; expanded           |
| `packages/keri/src/app/verifier-agent.ts` — `VerifierAgent.scanAcceptedGrants`                      | Reviewed; expanded           |
| `packages/keri/src/app/verifier-agent.ts` — `VerifierAgent.queueRevocation`                         | Reviewed; expanded           |
| `packages/keri/src/app/verifier-agent.ts` — `VerifierAgent.scanPersistedRevocations`                | Reviewed; expanded           |
| `packages/keri/src/app/verifier-agent.ts` — `VerifierAgent.postWebhook`                             | Reviewed; expanded           |
| `packages/keri/src/app/verifier-agent.ts` — `VerifierAgent.expired`                                 | Reviewed; expanded           |
| `packages/keri/src/app/verifier-agent.ts` — `nowDater`                                              | Reviewed; expanded           |
| `packages/keri/src/app/witnessing.ts` — `readResponseBytes`                                         | Reviewed; expanded           |
| `packages/keri/src/app/witnessing.ts` — `drainWitnessCues`                                          | Reviewed; expanded           |
| `packages/keri/src/app/witnessing.ts` — `processWitnessIngressSource`                               | Reviewed; expanded           |
| `packages/keri/src/app/witnessing.ts` — `processWitnessIngress`                                     | Reviewed; expanded           |
| `packages/keri/src/app/witnessing.ts` — `sendWitnessMessage`                                        | Reviewed; expanded           |
| `packages/keri/src/app/witnessing.ts` — `pollWitnessReceipt`                                        | Reviewed; expanded           |
| `packages/keri/src/app/witnessing.ts` — `postWitnessReceiptEndpoint`                                | Reviewed; expanded           |
| `packages/keri/src/app/witnessing.ts` — `getWitnessReceiptEndpoint`                                 | Reviewed; expanded           |
| `packages/keri/src/app/witnessing.ts` — `Receiptor`                                                 | Reviewed; expanded           |
| `packages/keri/src/app/witnessing.ts` — `Receiptor.constructor`                                     | Reviewed; expanded           |
| `packages/keri/src/app/witnessing.ts` — `Receiptor.receiptOnce`                                     | Reviewed; expanded           |
| `packages/keri/src/app/witnessing.ts` — `Receiptor.get`                                             | Reviewed; expanded           |
| `packages/keri/src/app/witnessing.ts` — `Receiptor.catchup`                                         | Reviewed; expanded           |
| `packages/keri/src/app/witnessing.ts` — `WitnessReceiptor`                                          | Reviewed; expanded           |
| `packages/keri/src/app/witnessing.ts` — `WitnessReceiptor.constructor`                              | Reviewed; expanded           |
| `packages/keri/src/did/webs/resolving.ts` — `resolveDidWebs`                                        | Reviewed; expanded           |
| `packages/keri/src/did/webs/resolving.ts` — `resolveArtifacts`                                      | Reviewed; expanded           |
| `packages/keri/src/did/webs/resolving.ts` — `artifactResponse`                                      | Reviewed; expanded           |
| `packages/tufa/src/cli/dws.ts` — `dwsResolverCommand`                                               | Reviewed; expanded           |
| `packages/tufa/src/cli/mailbox.ts` — `withMailboxWorkflow`                                          | Reviewed; expanded           |
| `packages/tufa/src/cli/mailbox.ts` — `postMailboxAdminCesr`                                         | Reviewed; expanded           |
| `packages/tufa/src/cli/mailbox.ts` — `postMailboxAdminMultipart`                                    | Reviewed; expanded           |
| `packages/tufa/src/cli/witness.ts` — `witnessSubmitCommand`                                         | Reviewed; expanded           |
| `packages/tufa/src/host/kernel.ts` — `runHostKernel`                                                | Reviewed; expanded           |
| `packages/tufa/src/http/protocol/endpoints/did-resolution.ts` — `handleDidResolutionRoute`          | Reviewed; expanded           |
| `packages/tufa/src/http/protocol/endpoints/generic-cesr-ingress.ts` — `deferredDirectQueryResponse` | Reviewed; expanded           |
| `packages/tufa/src/http/protocol/endpoints/generic-cesr-ingress.ts` — `ingest`                      | Reviewed; expanded           |
| `packages/tufa/src/http/protocol/runtime-bridge.ts` — `drainRuntimeCues`                            | Reviewed; expanded           |
| `packages/tufa/src/operator/mailbox-debug.ts` — `fetchMailboxDebug`                                 | Reviewed; expanded           |
| `packages/tufa/src/operator/mailbox-startup.ts` — `reconcileMailboxIdentity`                        | Reviewed; expanded           |
| `packages/tufa/src/operator/witness-startup.ts` — `reconcileWitnessIdentity`                        | Reviewed; expanded           |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxStreamOptions`                                | Reviewed; expanded           |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector`                                     | Reviewed; expanded           |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.constructor`                         | Reviewed; expanded           |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.hasMailboxStore`                     | Retired by #556              |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.registerTopic`                       | Reviewed; expanded           |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.registeredTopics`                    | Reviewed; expanded           |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.close`                               | Reviewed; retained           |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.cursor`                              | Reviewed; expanded           |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.retainQueryCue`                      | Reviewed; expanded           |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.publish`                             | Reviewed; expanded           |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.lastIndex`                           | Reviewed; expanded           |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.topicIter`                           | Reviewed; expanded           |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.streamMailbox`                       | Reviewed; expanded           |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.mailboxStream`                       | Reviewed; expanded           |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.mailboxStream.start`                 | Reviewed; expanded           |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.streamQueryResponse`                 | Reviewed; expanded           |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.streamQueryResponse.start`           | Reviewed; expanded           |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.remoteQueryCursor`                   | Reviewed; expanded           |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.updateRemoteCursor`                  | Reviewed; expanded           |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.hasQueryCue`                         | Reviewed; expanded           |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.takeQueryCue`                        | Reviewed; expanded           |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.requireMailboxer`                    | Reviewed; expanded           |
| `packages/keri/src/app/mailboxing.ts` — `mailboxerOptionsForHabery`                                 | Reviewed; expanded           |
| `packages/keri/src/app/mailboxing.ts` — `openMailboxerForHabery`                                    | Reviewed; expanded           |
| `packages/keri/src/app/mailboxing.ts` — `mailboxTopicKey`                                           | Reviewed; expanded           |
| `packages/keri/src/app/mailboxing.ts` — `mailboxQueryTopics`                                        | Reviewed; expanded           |
| `packages/keri/src/app/mailboxing.ts` — `updateMailboxRemoteCursor`                                 | Reviewed; expanded           |
| `packages/keri/src/app/mailboxing.ts` — `mailboxPollEndpoints`                                      | Reviewed; expanded           |
| `packages/keri/src/app/mailboxing.ts` — `mailboxDeliveryEndpoints`                                  | Reviewed; expanded           |
| `packages/keri/src/app/mailboxing.ts` — `directDeliveryEndpoints`                                   | Reviewed; expanded           |
| `packages/keri/src/app/mailboxing.ts` — `fetchEndpointUrls`                                         | Reviewed; expanded           |
| `packages/keri/src/app/mailboxing.ts` — `HostedEndpoint`                                            | Reviewed; expanded           |
| `packages/keri/src/app/mailboxing.ts` — `HostedEndpointPathMatch`                                   | Reviewed; expanded           |
| `packages/keri/src/app/mailboxing.ts` — `HostedRouteResolution`                                     | Reviewed; expanded           |
| `packages/keri/src/app/mailboxing.ts` — `hostedPrefixFilter`                                        | Reviewed; expanded           |
| `packages/keri/src/app/mailboxing.ts` — `hostedEndpointMatches`                                     | Reviewed; expanded           |
| `packages/keri/src/app/mailboxing.ts` — `hostedEndpointForPath`                                     | Reviewed; expanded           |
| `packages/keri/src/app/mailboxing.ts` — `hostedEndpointPathMatches`                                 | Reviewed; expanded           |
| `packages/keri/src/app/mailboxing.ts` — `resolveHostedEndpointPath`                                 | Reviewed; expanded           |
| `packages/keri/src/app/mailboxing.ts` — `flattenRoleUrls`                                           | Reviewed; expanded           |
| `packages/keri/src/app/mailboxing.ts` — `firstSortedEndpoint`                                       | Reviewed; expanded           |
| `packages/keri/src/app/mailboxing.ts` — `preferredUrl`                                              | Reviewed; expanded           |
| `packages/keri/src/app/mailboxing.ts` — `endpointBasePath`                                          | Reviewed; expanded           |
| `packages/keri/src/app/mailboxing.ts` — `joinBasePath`                                              | Reviewed; expanded           |
| `packages/keri/src/app/mailboxing.ts` — `normalizePath`                                             | Reviewed; expanded           |
| `packages/keri/src/app/mailboxing.ts` — `relativeHostedPath`                                        | Reviewed; expanded           |
| `packages/keri/src/app/mailboxing.ts` — `mailboxRemoteCursorRecord`                                 | Reviewed; expanded           |
| `packages/keri/src/app/runtime-turn.ts` — `runtimeTurn`                                             | Reviewed; retained           |

## Retired declarations

ReplyCursor, CueEmission, Hab.interpretCue, RuntimeServices and the separate
tcp-conversation module were removed. No compatibility documentation is reintroduced.

## Supporting contracts and final review

Phase 5 completed the cross-component review and checked local helper/callback
contracts with their enclosing operations. These supporting declarations extend
the historical diff without opening unrelated Hab, Kevery or Tevery methods:

| Source / qualified symbols                                                                                                                                                                         | Disposition                                                                          | Evidence                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| core/cues.ts — CueBase, ReceiptCue, WitnessCue, KelQueryFields, QueryInstruction, QueryRequest, QueryCue, ReplyCue, StreamCue, KeyStateSavedCue, TelQueryCue                                       | Reviewed; field contracts expanded or retained                                       | Kevery.decideQuery, Hab.processCuesIter; core/kevery-query, query-replies, runtime-responder |
| app/http-client.ts — FetchHttpClient.open.body; transportFailure and abortBody                                                                                                                     | Reviewed; correctly placed method/parameter and cancellation contracts               | http-client, cesr-egress                                                                     |
| app/querying.ts — QueryContinuation.done/observe/tick; app/query-replies.ts — QueryReplyBatch and Slot fields                                                                                      | Reviewed; explicit observation/correlation contracts                                 | querying, query-replies                                                                      |
| app/forwarding.ts — PosterOutcome and PreparedCesrTarget fields                                                                                                                                    | Reviewed; delivery, identity and packet-lifetime contracts expanded                  | poster-queue, forwarding                                                                     |
| app/cesr-egress.ts, tcp-egress.ts, socket-source.ts, reply-streams.ts, mailbox-sse.ts, mailbox-director.ts — named local cleanup/read callbacks                                                    | Reviewed at the owning operation; documented inputs, ordering and meaningful results | http-client, witness-transport, reply-streams, mailbox-sse, mailbox-director-lifecycle       |
| app/protocol-processing.ts — acquireProtocol.grant; app/agent-runtime.ts — clock callback; app/mailboxing.ts — endpoint predicate; Tufa host kernel/witness-tcp — cleanup and connection callbacks | Reviewed at the owning operation                                                     | reactor-turn, runtime-store-ownership, mailbox-poller-runtime; Tufa progressive-ingress      |

### Cross-component evidence and reading order

Tests below were read as evidence, not rerun for this documentation-only pass.

| Flow                                        | Source reading order                                                                                                  | Existing evidence                                                                                                                                                                                                                                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Receipt/replay to delivery                  | Hab.processCuesIter → Respondant → Poster → HTTPMessenger/TCPMessenger                                                | [runtime-responder](../../../packages/keri/test/unit/app/runtime-responder.test.ts), [poster-queue](../../../packages/keri/test/unit/app/poster-queue.test.ts)                                                                                                                                               |
| Query to accepted response and correlation  | QueryCoordinator → messenger/processMessages → ProtocolProcessor → QueryReplies → Respondant                          | [query-transport](../../../packages/keri/test/unit/app/query-transport.test.ts), [query-replies](../../../packages/keri/test/unit/app/query-replies.test.ts), [reactor-turn](../../../packages/keri/test/unit/app/reactor-turn.test.ts)                                                                      |
| Forwarded message to consumed mailbox event | ForwardHandler → Mailboxer → MailboxDirector → MailboxPoller/consumeMailboxSse → settleMailboxPollBatch               | [mailbox-runtime](../../../packages/keri/test/unit/app/mailbox-runtime.test.ts), [mailbox-poller-runtime](../../../packages/keri/test/unit/app/mailbox-poller-runtime.test.ts), [mailbox-sse](../../../packages/keri/test/unit/app/mailbox-sse.test.ts)                                                      |
| Request response to connection cleanup      | Tufa generic-cesr-ingress/processWitnessSocket → request correlation → ReplyStreams/socket output → listener teardown | [progressive-ingress](../../../packages/tufa/test/progressive-ingress.test.ts), [reply-streams](../../../packages/keri/test/unit/app/reply-streams.test.ts), [witness-transport](../../../packages/keri/test/unit/app/witness-transport.test.ts)                                                             |
| Finite command to store closure             | CLI/workflow → runAgentRuntimeUntil or Poster worker/wait → joined halt → runtime/store close                         | [runtime-store-ownership](../../../packages/keri/test/unit/app/runtime-store-ownership.test.ts), [CLI context](../../../packages/keri/test/unit/app/cli-context.test.ts), [Tufa CLI](../../../packages/tufa/test/cli.test.ts), [verifier-agent](../../../packages/keri/test/unit/app/verifier-agent.test.ts) |

No unresolved source/documentation contradiction remains in these reviewed paths.
The [plan](runtime-maintainer-documentation.md) tracks the separate cursor fix in
#554 and minimum-timeout fix in #555. The [local-consumption removal](remove-local-mailbox-consumption.md)
subsequently retires MailboxPoller.readLocalMailbox, its local cursor state and
MailboxDirector.hasMailboxStore. Provider reading APIs remain; the mailbox flow
above passes through HTTP/SSE before recipient processing. The original documentation
pass changed neither behavior.
