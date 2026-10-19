# Runtime documentation coverage

Status: pending review. Baseline `281fa5f7`; symbol positions are historical locators.

The ledger includes changed declarations plus complete transport/protocol owners.
Complete-owner class rows include member fields; contextual Hab/Kevery/Tevery rows cover only the touched contract. interface/type rows include field contracts.
Named local callbacks are reviewed with their enclosing function. Evidence names refer
to existing unit tests under `packages/keri/test/unit/app`, or the Tufa host tests.

## Phase 1

Evidence: http-client, cesr-egress, query-transport.

| Source / qualified symbol                                                         | Status                       |
| --------------------------------------------------------------------------------- | ---------------------------- |
| `packages/keri/src/app/cesr-egress.ts` — `CesrHttpRefusal`                        | Reviewed; contracts expanded |
| `packages/keri/src/app/cesr-egress.ts` — `CesrHttpRefusal.constructor`            | Reviewed; contracts expanded |
| `packages/keri/src/app/cesr-egress.ts` — `CesrPostResult`                         | Reviewed; contracts expanded |
| `packages/keri/src/app/cesr-egress.ts` — `FrameResponse`                          | Reviewed; contracts expanded |
| `packages/keri/src/app/cesr-egress.ts` — `EgressOptions`                          | Reviewed; contracts expanded |
| `packages/keri/src/app/cesr-egress.ts` — `readResponseBody`                       | Reviewed; contracts expanded |
| `packages/keri/src/app/cesr-egress.ts` — `requestFrame`                           | Reviewed; contracts expanded |
| `packages/keri/src/app/cesr-egress.ts` — `openFrameResponse`                      | Reviewed; contracts expanded |
| `packages/keri/src/app/cesr-egress.ts` — `frameRequests`                          | Reviewed; contracts expanded |
| `packages/keri/src/app/cesr-egress.ts` — `mediaRejection`                         | Reviewed; contracts expanded |
| `packages/keri/src/app/cesr-egress.ts` — `sendFrame`                              | Reviewed; contracts expanded |
| `packages/keri/src/app/cesr-egress.ts` — `postCesr`                               | Reviewed; contracts expanded |
| `packages/keri/src/app/cesr-egress.ts` — `attemptPostCesr`                        | Reviewed; contracts expanded |
| `packages/keri/src/app/http-client.ts` — `HttpRequestInit`                        | Reviewed; contracts expanded |
| `packages/keri/src/app/http-client.ts` — `HttpResponse`                           | Reviewed; contracts expanded |
| `packages/keri/src/app/http-client.ts` — `HttpStreamResponse`                     | Reviewed; contracts expanded |
| `packages/keri/src/app/http-client.ts` — `HttpClient`                             | Reviewed; contracts expanded |
| `packages/keri/src/app/http-client.ts` — `FetchHttpClient`                        | Reviewed; contracts expanded |
| `packages/keri/src/app/http-client.ts` — `FetchHttpClient.request`                | Reviewed; contracts expanded |
| `packages/keri/src/app/http-client.ts` — `FetchHttpClient.open`                   | Reviewed; contracts expanded |
| `packages/keri/src/app/http-client.ts` — `FetchHttpClient.body`                   | Reviewed; contracts expanded |
| `packages/keri/src/app/http-client.ts` — `FetchHttpClient.[Symbol.asyncIterator]` | Reviewed; contracts expanded |
| `packages/keri/src/app/http-messenger.ts` — `HTTPMessengerOptions`                | Reviewed; contracts expanded |
| `packages/keri/src/app/http-messenger.ts` — `HTTPMessenger`                       | Reviewed; contracts expanded |
| `packages/keri/src/app/http-messenger.ts` — `HTTPMessenger.constructor`           | Reviewed; contracts expanded |
| `packages/keri/src/app/http-messenger.ts` — `HTTPMessenger.send`                  | Reviewed; contracts expanded |
| `packages/keri/src/app/http-messenger.ts` — `HTTPMessenger.stream`                | Reviewed; contracts expanded |
| `packages/keri/src/app/http-messenger.ts` — `HTTPMessenger.query`                 | Reviewed; contracts expanded |
| `packages/keri/src/app/message-source.ts` — `IngressOptions`                      | Reviewed; contracts expanded |
| `packages/keri/src/app/message-source.ts` — `processMessages`                     | Reviewed; contracts expanded |
| `packages/keri/src/app/transport-error.ts` — `TransportError`                     | Reviewed; contracts expanded |
| `packages/keri/src/app/transport-error.ts` — `TransportError.constructor`         | Reviewed; contracts expanded |
| `packages/keri/src/app/abortable.ts` — `remainingFailures`                        | Reviewed; contracts expanded |
| `packages/keri/src/app/abortable.ts` — `rethrowCleanupFailure`                    | Reviewed; contracts expanded |
| `packages/keri/src/app/abortable.ts` — `abortable`                                | Reviewed; contracts expanded |
| `packages/keri/src/app/byte-source.ts` — `SourceOptions`                          | Reviewed; contracts expanded |
| `packages/keri/src/app/byte-source.ts` — `chunkBytes`                             | Reviewed; contracts expanded |
| `packages/keri/src/app/byte-source.ts` — `streamBytes`                            | Reviewed; contracts expanded |
| `packages/keri/src/app/byte-source.ts` — `fileBytes`                              | Reviewed; contracts expanded |
| `packages/keri/src/app/byte-source.ts` — `collectBytes`                           | Reviewed; contracts expanded |
| `packages/keri/src/app/byte-source.ts` — `checkLimit`                             | Reviewed; contracts expanded |

## Phase 2

Evidence: witness-transport, query-transport; Tufa progressive-ingress.

| Source / qualified symbol                                             | Status                       |
| --------------------------------------------------------------------- | ---------------------------- |
| `packages/keri/src/app/tcp-egress.ts` — `TcpSendOptions`              | Reviewed; contracts expanded |
| `packages/keri/src/app/tcp-egress.ts` — `TcpSourceFactory`            | Reviewed; contracts expanded |
| `packages/keri/src/app/tcp-egress.ts` — `TcpTransmission`             | Reviewed; contracts expanded |
| `packages/keri/src/app/tcp-egress.ts` — `TcpConnection`               | Reviewed; contracts expanded |
| `packages/keri/src/app/tcp-egress.ts` — `positive`                    | Reviewed; contracts expanded |
| `packages/keri/src/app/tcp-egress.ts` — `openTcpConnection`           | Reviewed; contracts expanded |
| `packages/keri/src/app/tcp-egress.ts` — `sendCesrTcp`                 | Reviewed; contracts expanded |
| `packages/keri/src/app/tcp-egress.ts` — `streamCesrTcp`               | Reviewed; contracts expanded |
| `packages/keri/src/app/tcp-egress.ts` — `sendCesrTcpFrame`            | Reviewed; contracts expanded |
| `packages/keri/src/app/tcp-egress.ts` — `TcpSocketWriteOptions`       | Reviewed; contracts expanded |
| `packages/keri/src/app/tcp-egress.ts` — `writeCesrTcpSocket`          | Reviewed; contracts expanded |
| `packages/keri/src/app/tcp-egress.ts` — `sendCesrTcpSocket`           | Reviewed; contracts expanded |
| `packages/keri/src/app/tcp-egress.ts` — `finishTcpOutput`             | Reviewed; contracts expanded |
| `packages/keri/src/app/tcp-egress.ts` — `eof`                         | Reviewed; contracts expanded |
| `packages/keri/src/app/tcp-egress.ts` — `interrupted`                 | Reviewed; contracts expanded |
| `packages/keri/src/app/tcp-egress.ts` — `writeBorrowedSource`         | Reviewed; contracts expanded |
| `packages/keri/src/app/tcp-messenger.ts` — `TCPMessengerOptions`      | Reviewed; contracts expanded |
| `packages/keri/src/app/tcp-messenger.ts` — `TCPConversation`          | Reviewed; contracts expanded |
| `packages/keri/src/app/tcp-messenger.ts` — `TCPMessengerResult`       | Reviewed; contracts expanded |
| `packages/keri/src/app/tcp-messenger.ts` — `TCPMessenger`             | Reviewed; contracts expanded |
| `packages/keri/src/app/tcp-messenger.ts` — `TCPMessenger.constructor` | Reviewed; contracts expanded |
| `packages/keri/src/app/tcp-messenger.ts` — `TCPMessenger.send`        | Reviewed; contracts expanded |
| `packages/keri/src/app/tcp-messenger.ts` — `TCPMessenger.stream`      | Reviewed; contracts expanded |
| `packages/keri/src/app/tcp-messenger.ts` — `TCPMessenger.converse`    | Reviewed; contracts expanded |
| `packages/tufa/src/host/witness-tcp.ts` — `WitnessTcpOptions`         | Reviewed; contracts expanded |
| `packages/tufa/src/host/witness-tcp.ts` — `isPeerError`               | Reviewed; contracts expanded |
| `packages/tufa/src/host/witness-tcp.ts` — `processWitnessSocket`      | Reviewed; contracts expanded |
| `packages/tufa/src/host/witness-tcp.ts` — `[Symbol.asyncIterator]`    | Reviewed; contracts expanded |
| `packages/tufa/src/host/witness-tcp.ts` — `return`                    | Reviewed; contracts expanded |
| `packages/tufa/src/host/witness-tcp.ts` — `witnessTcpListener`        | Reviewed; contracts expanded |
| `packages/tufa/src/host/witness-tcp.ts` — `startWitnessTcpServer`     | Reviewed; contracts expanded |
| `packages/keri/src/app/socket-source.ts` — `SocketSourceOptions`      | Reviewed; contracts expanded |
| `packages/keri/src/app/socket-source.ts` — `socketBytes`              | Reviewed; contracts expanded |
| `packages/keri/src/app/socket-source.ts` — `next`                     | Reviewed; contracts expanded |
| `packages/keri/src/app/socket-source.ts` — `return`                   | Reviewed; contracts expanded |
| `packages/keri/src/app/socket-source.ts` — `[Symbol.asyncIterator]`   | Reviewed; contracts expanded |

## Phase 3

Evidence: poster-queue, runtime-responder, query-replies, reactor-turn, cue-runtime.

| Source / qualified symbol                                                               | Status   |
| --------------------------------------------------------------------------------------- | -------- |
| `packages/keri/src/app/forwarding.ts` — `ExchangeDeliveryPreference`                    | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `PosterEvent`                                   | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `PosterOutcome`                                 | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `RawCesrRoute`                                  | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `PreparedCesrTarget`                            | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `remoteCesrTarget`                              | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `MailboxPollerOptions`                          | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `Poster`                                        | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `Poster.constructor`                            | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `Poster.send`                                   | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `Poster.sendAll`                                | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `Poster.retry`                                  | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `Poster.discard`                                | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `Poster.wait`                                   | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `Poster.takeOutcome`                            | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `Poster.deliverDo`                              | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `Poster.hasPending`                             | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `Poster.ensureOpen`                             | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `Poster.close`                                  | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `Poster.process`                                | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `Poster.finish`                                 | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `Poster.resolveRecipient`                       | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `Poster.deliverEvent`                           | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `Poster.canDeliver`                             | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `Poster.resolveBytesRoute`                      | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `Poster.findBytesRoute`                         | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `Poster.prepareBytesTarget`                     | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `Poster.prepareForwardedTarget`                 | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `Poster.requireMbx`                             | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `ForwardHandler`                                | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `ForwardHandler.constructor`                    | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `ForwardHandler.verify`                         | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `ForwardHandler.handle`                         | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `hostCanStoreForwardRecipient`                  | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `hasLocalStoreForwardHost`                      | Reviewed |
| `packages/keri/src/app/habbing.ts` — `Hab`                                              | Reviewed |
| `packages/keri/src/app/habbing.ts` — `Hab.processCuesIter`                              | Reviewed |
| `packages/keri/src/app/parsering.ts` — `dispatchEnvelope`                               | Reviewed |
| `packages/keri/src/app/protocol-processing.ts` — `DispatchOptions`                      | Reviewed |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolDispatchResult`               | Reviewed |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolProcessor`                    | Reviewed |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolProcessor.constructor`        | Reviewed |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolProcessor.makeKevery`         | Reviewed |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolProcessor.dispatch`           | Reviewed |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolProcessor.publishCues`        | Reviewed |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolProcessor.acquireProtocol`    | Reviewed |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolProcessor.processEscrowsOnce` | Reviewed |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolProcessor.advanceEscrows`     | Reviewed |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolProcessor.escrowDo`           | Reviewed |
| `packages/keri/src/app/protocol-processing.ts` — `createProtocolProcessor`              | Reviewed |
| `packages/keri/src/app/querying.ts` — `copyQuery`                                       | Reviewed |
| `packages/keri/src/app/querying.ts` — `QueryContinuation`                               | Reviewed |
| `packages/keri/src/app/querying.ts` — `soleHab`                                         | Reviewed |
| `packages/keri/src/app/querying.ts` — `parseHexOrdinal`                                 | Reviewed |
| `packages/keri/src/app/querying.ts` — `encodeHexOrdinal`                                | Reviewed |
| `packages/keri/src/app/querying.ts` — `KeyStateNoticer`                                 | Reviewed |
| `packages/keri/src/app/querying.ts` — `KeyStateNoticer.constructor`                     | Reviewed |
| `packages/keri/src/app/querying.ts` — `KeyStateNoticer.observe`                         | Reviewed |
| `packages/keri/src/app/querying.ts` — `KeyStateNoticer.tick`                            | Reviewed |
| `packages/keri/src/app/querying.ts` — `LogQuerier`                                      | Reviewed |
| `packages/keri/src/app/querying.ts` — `LogQuerier.constructor`                          | Reviewed |
| `packages/keri/src/app/querying.ts` — `LogQuerier.observe`                              | Reviewed |
| `packages/keri/src/app/querying.ts` — `LogQuerier.tick`                                 | Reviewed |
| `packages/keri/src/app/querying.ts` — `SeqNoQuerier`                                    | Reviewed |
| `packages/keri/src/app/querying.ts` — `SeqNoQuerier.constructor`                        | Reviewed |
| `packages/keri/src/app/querying.ts` — `SeqNoQuerier.observe`                            | Reviewed |
| `packages/keri/src/app/querying.ts` — `SeqNoQuerier.tick`                               | Reviewed |
| `packages/keri/src/app/querying.ts` — `AnchorQuerier`                                   | Reviewed |
| `packages/keri/src/app/querying.ts` — `AnchorQuerier.constructor`                       | Reviewed |
| `packages/keri/src/app/querying.ts` — `AnchorQuerier.observe`                           | Reviewed |
| `packages/keri/src/app/querying.ts` — `AnchorQuerier.tick`                              | Reviewed |
| `packages/keri/src/app/querying.ts` — `resolveQueryDestinationUrl`                      | Reviewed |
| `packages/keri/src/app/querying.ts` — `QueryDelivery`                                   | Reviewed |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator`                                | Reviewed |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.pending`                        | Reviewed |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.constructor`                    | Reviewed |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.configure`                      | Reviewed |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.watchKeyState`                  | Reviewed |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.watchSeqNo`                     | Reviewed |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.watchAnchor`                    | Reviewed |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.hasPendingWork`                 | Reviewed |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.enqueue`                        | Reviewed |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.enqueueCue`                     | Reviewed |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.hasPendingDelivery`             | Reviewed |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.deliverOnce`                    | Reviewed |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.postQueryMessage`               | Reviewed |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.processPending`                 | Reviewed |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.close`                          | Reviewed |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.queryDo`                        | Reviewed |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.configuredHab`                  | Reviewed |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.observeCue`                     | Reviewed |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.tickContinuations`              | Reviewed |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.compactContinuations`           | Reviewed |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.prepareRequest`                 | Reviewed |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.attestersFor`                   | Reviewed |
| `packages/keri/src/app/reactor.ts` — `Reactor`                                          | Reviewed |
| `packages/keri/src/app/reactor.ts` — `Reactor.constructor`                              | Reviewed |
| `packages/keri/src/app/reactor.ts` — `Reactor.hasIngress`                               | Reviewed |
| `packages/keri/src/app/reactor.ts` — `Reactor.process`                                  | Reviewed |
| `packages/keri/src/app/reactor.ts` — `Reactor.ingest`                                   | Reviewed |
| `packages/keri/src/app/reactor.ts` — `Reactor.clearIngress`                             | Reviewed |
| `packages/keri/src/app/reactor.ts` — `Reactor.processBytes`                             | Reviewed |
| `packages/keri/src/app/reactor.ts` — `Reactor.processOnce`                              | Reviewed |
| `packages/keri/src/app/reactor.ts` — `Reactor.msgDo`                                    | Reviewed |
| `packages/keri/src/app/respondant.ts` — `Respondant`                                    | Reviewed |
| `packages/keri/src/app/respondant.ts` — `Respondant.constructor`                        | Reviewed |
| `packages/keri/src/app/respondant.ts` — `Respondant.enqueueCue`                         | Reviewed |
| `packages/keri/src/app/respondant.ts` — `Respondant.enqueueMsgs`                        | Reviewed |
| `packages/keri/src/app/respondant.ts` — `Respondant.openReply`                          | Reviewed |
| `packages/keri/src/app/respondant.ts` — `Respondant.enqueueReply`                       | Reviewed |
| `packages/keri/src/app/respondant.ts` — `Respondant.prepareReplies`                     | Reviewed |
| `packages/keri/src/app/respondant.ts` — `topicForCue`                                   | Reviewed |
| `packages/keri/src/app/respondant.ts` — `recipientForCue`                               | Reviewed |
| `packages/keri/src/app/respondant.ts` — `senderHabForCue`                               | Reviewed |
| `packages/keri/src/app/respondant.ts` — `cueSourcePrefix`                               | Reviewed |
| `packages/keri/src/app/respondant.ts` — `soleHab`                                       | Reviewed |
| `packages/keri/src/core/cues.ts` — `ReplayCue`                                          | Reviewed |
| `packages/keri/src/core/eventing.ts` — `Kevery`                                         | Reviewed |
| `packages/keri/src/core/eventing.ts` — `Kevery.decideQuery`                             | Reviewed |
| `packages/keri/src/vdr/eventing.ts` — `Tevery`                                          | Reviewed |
| `packages/keri/src/vdr/eventing.ts` — `Tevery.processQuery`                             | Reviewed |
| `packages/keri/src/app/query-replies.ts` — `DirectReply`                                | Reviewed |
| `packages/keri/src/app/query-replies.ts` — `Slot`                                       | Reviewed |
| `packages/keri/src/app/query-replies.ts` — `QueryReplyBatch`                            | Reviewed |
| `packages/keri/src/app/query-replies.ts` — `QueryReply`                                 | Reviewed |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies`                               | Reviewed |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies.constructor`                   | Reviewed |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies.reserve`                       | Reviewed |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies.reserveEvent`                  | Reviewed |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies.reserveKey`                    | Reviewed |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies.ready`                         | Reviewed |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies.observeReady`                  | Reviewed |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies.peekAll`                       | Reviewed |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies.takeAll`                       | Reviewed |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies.capture`                       | Reviewed |
| `packages/keri/src/app/reply-streams.ts` — `ReplyStreams`                               | Reviewed |
| `packages/keri/src/app/reply-streams.ts` — `ReplyStreams.open`                          | Reviewed |
| `packages/keri/src/app/reply-streams.ts` — `ReplyStreams.openNonEmpty`                  | Reviewed |
| `packages/keri/src/app/reply-streams.ts` — `ReplyStreams.openChecked`                   | Reviewed |
| `packages/keri/src/app/reply-streams.ts` — `ReplyStreams.openOwned`                     | Reviewed |
| `packages/keri/src/app/reply-streams.ts` — `ReplyStreams.start`                         | Reviewed |
| `packages/keri/src/app/reply-streams.ts` — `ReplyStreams.close`                         | Reviewed |
| `packages/keri/src/app/cue-runtime.ts` — `resolveCueHab`                                | Reviewed |
| `packages/keri/src/app/cue-runtime.ts` — `processCuesOnce`                              | Reviewed |
| `packages/keri/src/app/cue-runtime.ts` — `cueDo`                                        | Reviewed |

## Phase 4

Evidence: mailbox-director-lifecycle, mailbox-poller-runtime, runtime-store-ownership, verifier-agent; CLI/workflow tests.

| Source / qualified symbol                                                                           | Status   |
| --------------------------------------------------------------------------------------------------- | -------- |
| `packages/keri/src/app/agent-runtime.ts` — `AgentRuntime`                                           | Reviewed |
| `packages/keri/src/app/agent-runtime.ts` — `AgentRuntimeOptions`                                    | Reviewed |
| `packages/keri/src/app/agent-runtime.ts` — `RuntimePendingState`                                    | Reviewed |
| `packages/keri/src/app/agent-runtime.ts` — `RuntimeOobiTerminalState`                               | Reviewed |
| `packages/keri/src/app/agent-runtime.ts` — `createAgentRuntime`                                     | Reviewed |
| `packages/keri/src/app/agent-runtime.ts` — `close`                                                  | Reviewed |
| `packages/keri/src/app/agent-runtime.ts` — `openRuntimeNoter`                                       | Reviewed |
| `packages/keri/src/app/agent-runtime.ts` — `openRuntimeMailboxer`                                   | Reviewed |
| `packages/keri/src/app/agent-runtime.ts` — `openAcdcRegeryForHabery`                                | Reviewed |
| `packages/keri/src/app/agent-runtime.ts` — `openRegerForHabery`                                     | Reviewed |
| `packages/keri/src/app/agent-runtime.ts` — `ingestKeriBytes`                                        | Reviewed |
| `packages/keri/src/app/agent-runtime.ts` — `enqueueOobi`                                            | Reviewed |
| `packages/keri/src/app/agent-runtime.ts` — `settleRuntimeIngress`                                   | Reviewed |
| `packages/keri/src/app/agent-runtime.ts` — `settleMailboxPollBatch`                                 | Reviewed |
| `packages/keri/src/app/agent-runtime.ts` — `runtimePendingState`                                    | Reviewed |
| `packages/keri/src/app/agent-runtime.ts` — `runtimeHasPendingWork`                                  | Reviewed |
| `packages/keri/src/app/agent-runtime.ts` — `runtimeHasWellKnownAuth`                                | Reviewed |
| `packages/keri/src/app/agent-runtime.ts` — `runtimeOobiTerminalState`                               | Reviewed |
| `packages/keri/src/app/agent-runtime.ts` — `runtimeOobiConverged`                                   | Reviewed |
| `packages/keri/src/app/agent-runtime.ts` — `runAgentRuntimeUntil`                                   | Reviewed |
| `packages/keri/src/app/agent-runtime.ts` — `runAgentRuntime`                                        | Reviewed |
| `packages/keri/src/app/authenticating.ts` — `Authenticator`                                         | Reviewed |
| `packages/keri/src/app/authenticating.ts` — `Authenticator.constructor`                             | Reviewed |
| `packages/keri/src/app/authenticating.ts` — `Authenticator.processPendingAuth`                      | Reviewed |
| `packages/keri/src/app/cli/challenge.ts` — `challengeRespondCommand`                                | Reviewed |
| `packages/keri/src/app/cli/common/context.ts` — `withAgentRuntime`                                  | Reviewed |
| `packages/keri/src/app/cli/delegate.ts` — `publishGroupDelegationApproval`                          | Reviewed |
| `packages/keri/src/app/cli/delegate.ts` — `performDelegationApproval`                               | Reviewed |
| `packages/keri/src/app/cli/did.ts` — `dwsResolveCommand`                                            | Reviewed |
| `packages/keri/src/app/cli/did.ts` — `receiptNewWitnessEvents`                                      | Reviewed |
| `packages/keri/src/app/cli/ends.ts` — `endsAddCommand`                                              | Reviewed |
| `packages/keri/src/app/cli/exchange.ts` — `exchangeSendCommand`                                     | Reviewed |
| `packages/keri/src/app/cli/incept.ts` — `inceptCommand`                                             | Reviewed |
| `packages/keri/src/app/cli/init.ts` — `initCommand`                                                 | Reviewed |
| `packages/keri/src/app/cli/interact.ts` — `interactCommand`                                         | Reviewed |
| `packages/keri/src/app/cli/ipex.ts` — `ipexApplyCommand`                                            | Reviewed |
| `packages/keri/src/app/cli/ipex.ts` — `ipexOfferCommand`                                            | Reviewed |
| `packages/keri/src/app/cli/ipex.ts` — `ipexGrantCommand`                                            | Reviewed |
| `packages/keri/src/app/cli/ipex.ts` — `ipexAdmitCommand`                                            | Reviewed |
| `packages/keri/src/app/cli/ipex.ts` — `ipexJoinCommand`                                             | Reviewed |
| `packages/keri/src/app/cli/ipex.ts` — `sendPriorResponse`                                           | Reviewed |
| `packages/keri/src/app/cli/ipex.ts` — `waitForMultisigIpexCompletion`                               | Reviewed |
| `packages/keri/src/app/cli/multisig.ts` — `receiptAcceptedEvent`                                    | Reviewed |
| `packages/keri/src/app/cli/oobi.ts` — `oobiRequestCommand`                                          | Reviewed |
| `packages/keri/src/app/cli/rotate.ts` — `rotateCommand`                                             | Reviewed |
| `packages/keri/src/app/cli/vc.ts` — `vcRegistryInceptCommand`                                       | Reviewed |
| `packages/keri/src/app/cli/vc.ts` — `vcCreateCommand`                                               | Reviewed |
| `packages/keri/src/app/cli/vc.ts` — `vcRevokeCommand`                                               | Reviewed |
| `packages/keri/src/app/cli/verifier.ts` — `verifierRunCommand`                                      | Reviewed |
| `packages/keri/src/app/credential-workflows.ts` — `inceptCredentialRegistry`                        | Reviewed |
| `packages/keri/src/app/credential-workflows.ts` — `createCredential`                                | Reviewed |
| `packages/keri/src/app/credential-workflows.ts` — `importCredentialStream`                          | Reviewed |
| `packages/keri/src/app/credential-workflows.ts` — `revokeCredential`                                | Reviewed |
| `packages/keri/src/app/credential-workflows.ts` — `proposeGroupRegistryIncept`                      | Reviewed |
| `packages/keri/src/app/credential-workflows.ts` — `proposeGroupCredentialIssue`                     | Reviewed |
| `packages/keri/src/app/credential-workflows.ts` — `publishGroupVcProposal`                          | Reviewed |
| `packages/keri/src/app/delegating.ts` — `Anchorer`                                                  | Reviewed |
| `packages/keri/src/app/delegating.ts` — `Anchorer.constructor`                                      | Reviewed |
| `packages/keri/src/app/delegating.ts` — `Anchorer.begin`                                            | Reviewed |
| `packages/keri/src/app/delegating.ts` — `Anchorer.processAllOnce`                                   | Reviewed |
| `packages/keri/src/app/delegating.ts` — `Anchorer.processPartialWitnessEscrow`                      | Reviewed |
| `packages/keri/src/app/delegating.ts` — `Anchorer.publishDelegator`                                 | Reviewed |
| `packages/keri/src/app/endpoint-roleing.ts` — `proposeGroupEndpointRole`                            | Reviewed |
| `packages/keri/src/app/exchange-messaging.ts` — `ExchangeMessageArgs`                               | Reviewed |
| `packages/keri/src/app/exchange-messaging.ts` — `createExchangeMessage`                             | Reviewed |
| `packages/keri/src/app/exchange-messaging.ts` — `sendExchangeMessage`                               | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller`                                             | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.constructor`                                 | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.registerTopic`                               | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.pollDo`                                      | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.readLocalMailbox`                            | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.localCursor`                                 | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.pollRemoteEndpointOnce`                      | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.syncRemoteWorkers`                           | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.remoteEndpointWorker`                        | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.remotePollTargets`                           | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.pollSignerHab`                               | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `MailboxPollTarget`                                         | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `buildForwardedDelivery`                                    | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `mailboxReplyPayload`                                       | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `introductionMessages`                                      | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `[Symbol.iterator]`                                         | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `introduce`                                                 | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `remoteAlreadyReceiptedLatestEvent`                         | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `defaultTopicForRoute`                                      | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `pollMailboxTopic`                                          | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `transportMailboxTopic`                                     | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `mailboxTopicForRoute`                                      | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `extractForwardedMessage`                                   | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `embeddedSerderRaw`                                         | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `forwardedAttachmentForPath`                                | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `MailboxPollingTimeoutPolicy`                               | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `MailboxPollBatch`                                          | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `MailboxFetchTimeoutPolicy`                                 | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `MailboxPollTransportRequest`                               | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `MailboxPollTransport`                                      | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `poll`                                                      | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `fetchMailboxMessages`                                      | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `fetchMailboxQueryResponse`                                 | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `normalizeMailboxPollingTimeoutPolicy`                      | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `mailboxFetchTimeoutPolicy`                                 | Reviewed |
| `packages/keri/src/app/forwarding.ts` — `positiveTimeoutMs`                                         | Reviewed |
| `packages/keri/src/app/httping.ts` — `requestWithHeaderTimeout`                                     | Reviewed |
| `packages/keri/src/app/ipex-credentialing.ts` — `processCredentialPresentationArtifacts`            | Reviewed |
| `packages/keri/src/app/ipex-grouping.ts` — `approveMultisigIpex`                                    | Reviewed |
| `packages/keri/src/app/ipex-grouping.ts` — `publishGroupIpexProposal`                               | Reviewed |
| `packages/keri/src/app/ipex-grouping.ts` — `findPendingMultisigIpex`                                | Reviewed |
| `packages/keri/src/app/ipex-grouping.ts` — `sendCompletedGroupIpex`                                 | Reviewed |
| `packages/keri/src/app/ipex-grouping.ts` — `sendCredentialBytes`                                    | Reviewed |
| `packages/keri/src/app/mailbox-sse.ts` — `MailboxSseMessage`                                        | Reviewed |
| `packages/keri/src/app/mailbox-sse.ts` — `MailboxSseOptions`                                        | Reviewed |
| `packages/keri/src/app/mailbox-sse.ts` — `eventMessage`                                             | Reviewed |
| `packages/keri/src/app/mailbox-sse.ts` — `appendBytes`                                              | Reviewed |
| `packages/keri/src/app/mailbox-sse.ts` — `consumeMailboxSse`                                        | Reviewed |
| `packages/keri/src/app/mailbox-sse.ts` — `readMailboxSseBody`                                       | Reviewed |
| `packages/keri/src/app/mailbox-sse.ts` — `parseMailboxSse`                                          | Reviewed |
| `packages/keri/src/app/mailbox-sse.ts` — `consumeChunks`                                            | Reviewed |
| `packages/keri/src/app/multisig-workflows.ts` — `publishProposal`                                   | Reviewed |
| `packages/keri/src/app/multisig-workflows.ts` — `publishVdrProposal`                                | Reviewed |
| `packages/keri/src/app/multisig-workflows.ts` — `registerAndSendProposal`                           | Reviewed |
| `packages/keri/src/app/multisig-workflows.ts` — `approveRpyProposal`                                | Reviewed |
| `packages/keri/src/app/multisig-workflows.ts` — `approveKelProposal`                                | Reviewed |
| `packages/keri/src/app/multisig-workflows.ts` — `approveVdrProposal`                                | Reviewed |
| `packages/keri/src/app/oobiery.ts` — `Oobiery`                                                      | Reviewed |
| `packages/keri/src/app/oobiery.ts` — `Oobiery.constructor`                                          | Reviewed |
| `packages/keri/src/app/oobiery.ts` — `Oobiery.registerReplyRoutes`                                  | Reviewed |
| `packages/keri/src/app/oobiery.ts` — `Oobiery.processJob`                                           | Reviewed |
| `packages/keri/src/app/oobiery.ts` — `Oobiery.processResponse`                                      | Reviewed |
| `packages/keri/src/app/oobiery.ts` — `Oobiery.resolveCesrOobiResponse`                              | Reviewed |
| `packages/keri/src/app/oobiery.ts` — `Oobiery.processReply`                                         | Reviewed |
| `packages/keri/src/app/oobiery.ts` — `readResponseBytes`                                            | Reviewed |
| `packages/keri/src/app/runtime-clock.ts` — `RuntimeTimer`                                           | Reviewed |
| `packages/keri/src/app/runtime-clock.ts` — `RuntimeClock`                                           | Reviewed |
| `packages/keri/src/app/verifier-agent.ts` — `VerifierAgentOptions`                                  | Reviewed |
| `packages/keri/src/app/verifier-agent.ts` — `VerifierAgent`                                         | Reviewed |
| `packages/keri/src/app/verifier-agent.ts` — `VerifierAgent.constructor`                             | Reviewed |
| `packages/keri/src/app/verifier-agent.ts` — `VerifierAgent.processOnce`                             | Reviewed |
| `packages/keri/src/app/verifier-agent.ts` — `VerifierAgent.scanAcceptedGrants`                      | Reviewed |
| `packages/keri/src/app/verifier-agent.ts` — `VerifierAgent.queueRevocation`                         | Reviewed |
| `packages/keri/src/app/verifier-agent.ts` — `VerifierAgent.scanPersistedRevocations`                | Reviewed |
| `packages/keri/src/app/verifier-agent.ts` — `VerifierAgent.postWebhook`                             | Reviewed |
| `packages/keri/src/app/verifier-agent.ts` — `VerifierAgent.expired`                                 | Reviewed |
| `packages/keri/src/app/verifier-agent.ts` — `nowDater`                                              | Reviewed |
| `packages/keri/src/app/witnessing.ts` — `readResponseBytes`                                         | Reviewed |
| `packages/keri/src/app/witnessing.ts` — `drainWitnessCues`                                          | Reviewed |
| `packages/keri/src/app/witnessing.ts` — `processWitnessIngressSource`                               | Reviewed |
| `packages/keri/src/app/witnessing.ts` — `processWitnessIngress`                                     | Reviewed |
| `packages/keri/src/app/witnessing.ts` — `sendWitnessMessage`                                        | Reviewed |
| `packages/keri/src/app/witnessing.ts` — `pollWitnessReceipt`                                        | Reviewed |
| `packages/keri/src/app/witnessing.ts` — `postWitnessReceiptEndpoint`                                | Reviewed |
| `packages/keri/src/app/witnessing.ts` — `getWitnessReceiptEndpoint`                                 | Reviewed |
| `packages/keri/src/app/witnessing.ts` — `Receiptor`                                                 | Reviewed |
| `packages/keri/src/app/witnessing.ts` — `Receiptor.constructor`                                     | Reviewed |
| `packages/keri/src/app/witnessing.ts` — `Receiptor.receiptOnce`                                     | Reviewed |
| `packages/keri/src/app/witnessing.ts` — `Receiptor.get`                                             | Reviewed |
| `packages/keri/src/app/witnessing.ts` — `Receiptor.catchup`                                         | Reviewed |
| `packages/keri/src/app/witnessing.ts` — `WitnessReceiptor`                                          | Reviewed |
| `packages/keri/src/app/witnessing.ts` — `WitnessReceiptor.constructor`                              | Reviewed |
| `packages/keri/src/did/webs/resolving.ts` — `resolveDidWebs`                                        | Reviewed |
| `packages/keri/src/did/webs/resolving.ts` — `resolveArtifacts`                                      | Reviewed |
| `packages/keri/src/did/webs/resolving.ts` — `artifactResponse`                                      | Reviewed |
| `packages/tufa/src/cli/dws.ts` — `dwsResolverCommand`                                               | Reviewed |
| `packages/tufa/src/cli/mailbox.ts` — `withMailboxWorkflow`                                          | Reviewed |
| `packages/tufa/src/cli/mailbox.ts` — `postMailboxAdminCesr`                                         | Reviewed |
| `packages/tufa/src/cli/mailbox.ts` — `postMailboxAdminMultipart`                                    | Reviewed |
| `packages/tufa/src/cli/witness.ts` — `witnessSubmitCommand`                                         | Reviewed |
| `packages/tufa/src/host/kernel.ts` — `runHostKernel`                                                | Reviewed |
| `packages/tufa/src/http/protocol/endpoints/did-resolution.ts` — `handleDidResolutionRoute`          | Reviewed |
| `packages/tufa/src/http/protocol/endpoints/generic-cesr-ingress.ts` — `deferredDirectQueryResponse` | Reviewed |
| `packages/tufa/src/http/protocol/endpoints/generic-cesr-ingress.ts` — `ingest`                      | Reviewed |
| `packages/tufa/src/http/protocol/runtime-bridge.ts` — `drainRuntimeCues`                            | Reviewed |
| `packages/tufa/src/operator/mailbox-debug.ts` — `fetchMailboxDebug`                                 | Reviewed |
| `packages/tufa/src/operator/mailbox-startup.ts` — `reconcileMailboxIdentity`                        | Reviewed |
| `packages/tufa/src/operator/witness-startup.ts` — `reconcileWitnessIdentity`                        | Reviewed |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxStreamOptions`                                | Reviewed |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector`                                     | Reviewed |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.constructor`                         | Reviewed |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.hasMailboxStore`                     | Reviewed |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.registerTopic`                       | Reviewed |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.registeredTopics`                    | Reviewed |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.close`                               | Reviewed |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.cursor`                              | Reviewed |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.retainQueryCue`                      | Reviewed |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.publish`                             | Reviewed |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.lastIndex`                           | Reviewed |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.topicIter`                           | Reviewed |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.streamMailbox`                       | Reviewed |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.mailboxStream`                       | Reviewed |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.start`                               | Reviewed |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.streamQueryResponse`                 | Reviewed |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.start`                               | Reviewed |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.remoteQueryCursor`                   | Reviewed |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.updateRemoteCursor`                  | Reviewed |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.hasQueryCue`                         | Reviewed |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.takeQueryCue`                        | Reviewed |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.requireMailboxer`                    | Reviewed |
| `packages/keri/src/app/mailboxing.ts` — `mailboxerOptionsForHabery`                                 | Reviewed |
| `packages/keri/src/app/mailboxing.ts` — `openMailboxerForHabery`                                    | Reviewed |
| `packages/keri/src/app/mailboxing.ts` — `mailboxTopicKey`                                           | Reviewed |
| `packages/keri/src/app/mailboxing.ts` — `mailboxQueryTopics`                                        | Reviewed |
| `packages/keri/src/app/mailboxing.ts` — `updateMailboxRemoteCursor`                                 | Reviewed |
| `packages/keri/src/app/mailboxing.ts` — `mailboxPollEndpoints`                                      | Reviewed |
| `packages/keri/src/app/mailboxing.ts` — `mailboxDeliveryEndpoints`                                  | Reviewed |
| `packages/keri/src/app/mailboxing.ts` — `directDeliveryEndpoints`                                   | Reviewed |
| `packages/keri/src/app/mailboxing.ts` — `fetchEndpointUrls`                                         | Reviewed |
| `packages/keri/src/app/mailboxing.ts` — `HostedEndpoint`                                            | Reviewed |
| `packages/keri/src/app/mailboxing.ts` — `HostedEndpointPathMatch`                                   | Reviewed |
| `packages/keri/src/app/mailboxing.ts` — `HostedRouteResolution`                                     | Reviewed |
| `packages/keri/src/app/mailboxing.ts` — `hostedPrefixFilter`                                        | Reviewed |
| `packages/keri/src/app/mailboxing.ts` — `hostedEndpointMatches`                                     | Reviewed |
| `packages/keri/src/app/mailboxing.ts` — `hostedEndpointForPath`                                     | Reviewed |
| `packages/keri/src/app/mailboxing.ts` — `hostedEndpointPathMatches`                                 | Reviewed |
| `packages/keri/src/app/mailboxing.ts` — `resolveHostedEndpointPath`                                 | Reviewed |
| `packages/keri/src/app/mailboxing.ts` — `flattenRoleUrls`                                           | Reviewed |
| `packages/keri/src/app/mailboxing.ts` — `firstSortedEndpoint`                                       | Reviewed |
| `packages/keri/src/app/mailboxing.ts` — `preferredUrl`                                              | Reviewed |
| `packages/keri/src/app/mailboxing.ts` — `endpointBasePath`                                          | Reviewed |
| `packages/keri/src/app/mailboxing.ts` — `joinBasePath`                                              | Reviewed |
| `packages/keri/src/app/mailboxing.ts` — `normalizePath`                                             | Reviewed |
| `packages/keri/src/app/mailboxing.ts` — `relativeHostedPath`                                        | Reviewed |
| `packages/keri/src/app/mailboxing.ts` — `mailboxRemoteCursorRecord`                                 | Reviewed |
| `packages/keri/src/app/runtime-turn.ts` — `runtimeTurn`                                             | Reviewed |

## Retired declarations

ReplyCursor, CueEmission, Hab.interpretCue, RuntimeServices and the separate
tcp-conversation module were removed. No compatibility documentation is reintroduced.
