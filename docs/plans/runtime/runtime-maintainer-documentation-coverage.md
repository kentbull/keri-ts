# Runtime documentation coverage

Status: pending review. Baseline `281fa5f7`; symbol positions are historical locators.

The ledger includes changed declarations plus complete transport/protocol owners.
Class rows include review of member fields; interface/type rows include field contracts.
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

| Source / qualified symbol                                                               | Status  |
| --------------------------------------------------------------------------------------- | ------- |
| `packages/keri/src/app/forwarding.ts` — `ExchangeDeliveryPreference`                    | Pending |
| `packages/keri/src/app/forwarding.ts` — `PosterEvent`                                   | Pending |
| `packages/keri/src/app/forwarding.ts` — `PosterOutcome`                                 | Pending |
| `packages/keri/src/app/forwarding.ts` — `RawCesrRoute`                                  | Pending |
| `packages/keri/src/app/forwarding.ts` — `PreparedCesrTarget`                            | Pending |
| `packages/keri/src/app/forwarding.ts` — `remoteCesrTarget`                              | Pending |
| `packages/keri/src/app/forwarding.ts` — `MailboxPollerOptions`                          | Pending |
| `packages/keri/src/app/forwarding.ts` — `Poster`                                        | Pending |
| `packages/keri/src/app/forwarding.ts` — `Poster.constructor`                            | Pending |
| `packages/keri/src/app/forwarding.ts` — `Poster.send`                                   | Pending |
| `packages/keri/src/app/forwarding.ts` — `Poster.sendAll`                                | Pending |
| `packages/keri/src/app/forwarding.ts` — `Poster.retry`                                  | Pending |
| `packages/keri/src/app/forwarding.ts` — `Poster.discard`                                | Pending |
| `packages/keri/src/app/forwarding.ts` — `Poster.wait`                                   | Pending |
| `packages/keri/src/app/forwarding.ts` — `Poster.takeOutcome`                            | Pending |
| `packages/keri/src/app/forwarding.ts` — `Poster.deliverDo`                              | Pending |
| `packages/keri/src/app/forwarding.ts` — `Poster.hasPending`                             | Pending |
| `packages/keri/src/app/forwarding.ts` — `Poster.ensureOpen`                             | Pending |
| `packages/keri/src/app/forwarding.ts` — `Poster.close`                                  | Pending |
| `packages/keri/src/app/forwarding.ts` — `Poster.process`                                | Pending |
| `packages/keri/src/app/forwarding.ts` — `Poster.finish`                                 | Pending |
| `packages/keri/src/app/forwarding.ts` — `Poster.resolveRecipient`                       | Pending |
| `packages/keri/src/app/forwarding.ts` — `Poster.deliverEvent`                           | Pending |
| `packages/keri/src/app/forwarding.ts` — `Poster.canDeliver`                             | Pending |
| `packages/keri/src/app/forwarding.ts` — `Poster.resolveBytesRoute`                      | Pending |
| `packages/keri/src/app/forwarding.ts` — `Poster.findBytesRoute`                         | Pending |
| `packages/keri/src/app/forwarding.ts` — `Poster.prepareBytesTarget`                     | Pending |
| `packages/keri/src/app/forwarding.ts` — `Poster.prepareForwardedTarget`                 | Pending |
| `packages/keri/src/app/forwarding.ts` — `Poster.requireMbx`                             | Pending |
| `packages/keri/src/app/forwarding.ts` — `ForwardHandler`                                | Pending |
| `packages/keri/src/app/forwarding.ts` — `ForwardHandler.constructor`                    | Pending |
| `packages/keri/src/app/forwarding.ts` — `ForwardHandler.verify`                         | Pending |
| `packages/keri/src/app/forwarding.ts` — `ForwardHandler.handle`                         | Pending |
| `packages/keri/src/app/forwarding.ts` — `hostCanStoreForwardRecipient`                  | Pending |
| `packages/keri/src/app/forwarding.ts` — `hasLocalStoreForwardHost`                      | Pending |
| `packages/keri/src/app/habbing.ts` — `Hab`                                              | Pending |
| `packages/keri/src/app/habbing.ts` — `Hab.processCuesIter`                              | Pending |
| `packages/keri/src/app/parsering.ts` — `dispatchEnvelope`                               | Pending |
| `packages/keri/src/app/protocol-processing.ts` — `DispatchOptions`                      | Pending |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolDispatchResult`               | Pending |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolProcessor`                    | Pending |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolProcessor.constructor`        | Pending |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolProcessor.makeKevery`         | Pending |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolProcessor.dispatch`           | Pending |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolProcessor.publishCues`        | Pending |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolProcessor.acquireProtocol`    | Pending |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolProcessor.processEscrowsOnce` | Pending |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolProcessor.advanceEscrows`     | Pending |
| `packages/keri/src/app/protocol-processing.ts` — `ProtocolProcessor.escrowDo`           | Pending |
| `packages/keri/src/app/protocol-processing.ts` — `createProtocolProcessor`              | Pending |
| `packages/keri/src/app/querying.ts` — `copyQuery`                                       | Pending |
| `packages/keri/src/app/querying.ts` — `QueryContinuation`                               | Pending |
| `packages/keri/src/app/querying.ts` — `soleHab`                                         | Pending |
| `packages/keri/src/app/querying.ts` — `parseHexOrdinal`                                 | Pending |
| `packages/keri/src/app/querying.ts` — `encodeHexOrdinal`                                | Pending |
| `packages/keri/src/app/querying.ts` — `KeyStateNoticer`                                 | Pending |
| `packages/keri/src/app/querying.ts` — `KeyStateNoticer.constructor`                     | Pending |
| `packages/keri/src/app/querying.ts` — `KeyStateNoticer.observe`                         | Pending |
| `packages/keri/src/app/querying.ts` — `KeyStateNoticer.tick`                            | Pending |
| `packages/keri/src/app/querying.ts` — `LogQuerier`                                      | Pending |
| `packages/keri/src/app/querying.ts` — `LogQuerier.constructor`                          | Pending |
| `packages/keri/src/app/querying.ts` — `LogQuerier.observe`                              | Pending |
| `packages/keri/src/app/querying.ts` — `LogQuerier.tick`                                 | Pending |
| `packages/keri/src/app/querying.ts` — `SeqNoQuerier`                                    | Pending |
| `packages/keri/src/app/querying.ts` — `SeqNoQuerier.constructor`                        | Pending |
| `packages/keri/src/app/querying.ts` — `SeqNoQuerier.observe`                            | Pending |
| `packages/keri/src/app/querying.ts` — `SeqNoQuerier.tick`                               | Pending |
| `packages/keri/src/app/querying.ts` — `AnchorQuerier`                                   | Pending |
| `packages/keri/src/app/querying.ts` — `AnchorQuerier.constructor`                       | Pending |
| `packages/keri/src/app/querying.ts` — `AnchorQuerier.observe`                           | Pending |
| `packages/keri/src/app/querying.ts` — `AnchorQuerier.tick`                              | Pending |
| `packages/keri/src/app/querying.ts` — `resolveQueryDestinationUrl`                      | Pending |
| `packages/keri/src/app/querying.ts` — `QueryDelivery`                                   | Pending |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator`                                | Pending |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.pending`                        | Pending |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.constructor`                    | Pending |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.configure`                      | Pending |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.watchKeyState`                  | Pending |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.watchSeqNo`                     | Pending |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.watchAnchor`                    | Pending |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.hasPendingWork`                 | Pending |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.enqueue`                        | Pending |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.enqueueCue`                     | Pending |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.hasPendingDelivery`             | Pending |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.deliverOnce`                    | Pending |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.postQueryMessage`               | Pending |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.processPending`                 | Pending |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.close`                          | Pending |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.queryDo`                        | Pending |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.configuredHab`                  | Pending |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.observeCue`                     | Pending |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.tickContinuations`              | Pending |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.compactContinuations`           | Pending |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.prepareRequest`                 | Pending |
| `packages/keri/src/app/querying.ts` — `QueryCoordinator.attestersFor`                   | Pending |
| `packages/keri/src/app/reactor.ts` — `Reactor`                                          | Pending |
| `packages/keri/src/app/reactor.ts` — `Reactor.constructor`                              | Pending |
| `packages/keri/src/app/reactor.ts` — `Reactor.hasIngress`                               | Pending |
| `packages/keri/src/app/reactor.ts` — `Reactor.process`                                  | Pending |
| `packages/keri/src/app/reactor.ts` — `Reactor.ingest`                                   | Pending |
| `packages/keri/src/app/reactor.ts` — `Reactor.clearIngress`                             | Pending |
| `packages/keri/src/app/reactor.ts` — `Reactor.processBytes`                             | Pending |
| `packages/keri/src/app/reactor.ts` — `Reactor.processOnce`                              | Pending |
| `packages/keri/src/app/reactor.ts` — `Reactor.msgDo`                                    | Pending |
| `packages/keri/src/app/respondant.ts` — `Respondant`                                    | Pending |
| `packages/keri/src/app/respondant.ts` — `Respondant.constructor`                        | Pending |
| `packages/keri/src/app/respondant.ts` — `Respondant.enqueueCue`                         | Pending |
| `packages/keri/src/app/respondant.ts` — `Respondant.enqueueMsgs`                        | Pending |
| `packages/keri/src/app/respondant.ts` — `Respondant.openReply`                          | Pending |
| `packages/keri/src/app/respondant.ts` — `Respondant.enqueueReply`                       | Pending |
| `packages/keri/src/app/respondant.ts` — `Respondant.prepareReplies`                     | Pending |
| `packages/keri/src/app/respondant.ts` — `topicForCue`                                   | Pending |
| `packages/keri/src/app/respondant.ts` — `recipientForCue`                               | Pending |
| `packages/keri/src/app/respondant.ts` — `senderHabForCue`                               | Pending |
| `packages/keri/src/app/respondant.ts` — `cueSourcePrefix`                               | Pending |
| `packages/keri/src/app/respondant.ts` — `soleHab`                                       | Pending |
| `packages/keri/src/core/cues.ts` — `ReplayCue`                                          | Pending |
| `packages/keri/src/core/eventing.ts` — `Kevery`                                         | Pending |
| `packages/keri/src/core/eventing.ts` — `Kevery.decideQuery`                             | Pending |
| `packages/keri/src/vdr/eventing.ts` — `Tevery`                                          | Pending |
| `packages/keri/src/vdr/eventing.ts` — `Tevery.processQuery`                             | Pending |
| `packages/keri/src/app/query-replies.ts` — `DirectReply`                                | Pending |
| `packages/keri/src/app/query-replies.ts` — `Slot`                                       | Pending |
| `packages/keri/src/app/query-replies.ts` — `QueryReplyBatch`                            | Pending |
| `packages/keri/src/app/query-replies.ts` — `QueryReply`                                 | Pending |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies`                               | Pending |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies.constructor`                   | Pending |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies.reserve`                       | Pending |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies.reserveEvent`                  | Pending |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies.reserveKey`                    | Pending |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies.ready`                         | Pending |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies.observeReady`                  | Pending |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies.peekAll`                       | Pending |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies.takeAll`                       | Pending |
| `packages/keri/src/app/query-replies.ts` — `QueryReplies.capture`                       | Pending |
| `packages/keri/src/app/reply-streams.ts` — `ReplyStreams`                               | Pending |
| `packages/keri/src/app/reply-streams.ts` — `ReplyStreams.open`                          | Pending |
| `packages/keri/src/app/reply-streams.ts` — `ReplyStreams.openNonEmpty`                  | Pending |
| `packages/keri/src/app/reply-streams.ts` — `ReplyStreams.openChecked`                   | Pending |
| `packages/keri/src/app/reply-streams.ts` — `ReplyStreams.openOwned`                     | Pending |
| `packages/keri/src/app/reply-streams.ts` — `ReplyStreams.start`                         | Pending |
| `packages/keri/src/app/reply-streams.ts` — `ReplyStreams.close`                         | Pending |
| `packages/keri/src/app/cue-runtime.ts` — `resolveCueHab`                                | Pending |
| `packages/keri/src/app/cue-runtime.ts` — `processCuesOnce`                              | Pending |
| `packages/keri/src/app/cue-runtime.ts` — `cueDo`                                        | Pending |

## Phase 4

Evidence: mailbox-director-lifecycle, mailbox-poller-runtime, runtime-store-ownership, verifier-agent; CLI/workflow tests.

| Source / qualified symbol                                                                           | Status  |
| --------------------------------------------------------------------------------------------------- | ------- |
| `packages/keri/src/app/agent-runtime.ts` — `AgentRuntime`                                           | Pending |
| `packages/keri/src/app/agent-runtime.ts` — `AgentRuntimeOptions`                                    | Pending |
| `packages/keri/src/app/agent-runtime.ts` — `RuntimePendingState`                                    | Pending |
| `packages/keri/src/app/agent-runtime.ts` — `RuntimeOobiTerminalState`                               | Pending |
| `packages/keri/src/app/agent-runtime.ts` — `createAgentRuntime`                                     | Pending |
| `packages/keri/src/app/agent-runtime.ts` — `close`                                                  | Pending |
| `packages/keri/src/app/agent-runtime.ts` — `openRuntimeNoter`                                       | Pending |
| `packages/keri/src/app/agent-runtime.ts` — `openRuntimeMailboxer`                                   | Pending |
| `packages/keri/src/app/agent-runtime.ts` — `openAcdcRegeryForHabery`                                | Pending |
| `packages/keri/src/app/agent-runtime.ts` — `openRegerForHabery`                                     | Pending |
| `packages/keri/src/app/agent-runtime.ts` — `ingestKeriBytes`                                        | Pending |
| `packages/keri/src/app/agent-runtime.ts` — `enqueueOobi`                                            | Pending |
| `packages/keri/src/app/agent-runtime.ts` — `settleRuntimeIngress`                                   | Pending |
| `packages/keri/src/app/agent-runtime.ts` — `settleMailboxPollBatch`                                 | Pending |
| `packages/keri/src/app/agent-runtime.ts` — `runtimePendingState`                                    | Pending |
| `packages/keri/src/app/agent-runtime.ts` — `runtimeHasPendingWork`                                  | Pending |
| `packages/keri/src/app/agent-runtime.ts` — `runtimeHasWellKnownAuth`                                | Pending |
| `packages/keri/src/app/agent-runtime.ts` — `runtimeOobiTerminalState`                               | Pending |
| `packages/keri/src/app/agent-runtime.ts` — `runtimeOobiConverged`                                   | Pending |
| `packages/keri/src/app/agent-runtime.ts` — `runAgentRuntimeUntil`                                   | Pending |
| `packages/keri/src/app/agent-runtime.ts` — `runAgentRuntime`                                        | Pending |
| `packages/keri/src/app/authenticating.ts` — `Authenticator`                                         | Pending |
| `packages/keri/src/app/authenticating.ts` — `Authenticator.constructor`                             | Pending |
| `packages/keri/src/app/authenticating.ts` — `Authenticator.processPendingAuth`                      | Pending |
| `packages/keri/src/app/cli/challenge.ts` — `challengeRespondCommand`                                | Pending |
| `packages/keri/src/app/cli/common/context.ts` — `withAgentRuntime`                                  | Pending |
| `packages/keri/src/app/cli/delegate.ts` — `publishGroupDelegationApproval`                          | Pending |
| `packages/keri/src/app/cli/delegate.ts` — `performDelegationApproval`                               | Pending |
| `packages/keri/src/app/cli/did.ts` — `dwsResolveCommand`                                            | Pending |
| `packages/keri/src/app/cli/did.ts` — `receiptNewWitnessEvents`                                      | Pending |
| `packages/keri/src/app/cli/ends.ts` — `endsAddCommand`                                              | Pending |
| `packages/keri/src/app/cli/exchange.ts` — `exchangeSendCommand`                                     | Pending |
| `packages/keri/src/app/cli/incept.ts` — `inceptCommand`                                             | Pending |
| `packages/keri/src/app/cli/init.ts` — `initCommand`                                                 | Pending |
| `packages/keri/src/app/cli/interact.ts` — `interactCommand`                                         | Pending |
| `packages/keri/src/app/cli/ipex.ts` — `ipexApplyCommand`                                            | Pending |
| `packages/keri/src/app/cli/ipex.ts` — `ipexOfferCommand`                                            | Pending |
| `packages/keri/src/app/cli/ipex.ts` — `ipexGrantCommand`                                            | Pending |
| `packages/keri/src/app/cli/ipex.ts` — `ipexAdmitCommand`                                            | Pending |
| `packages/keri/src/app/cli/ipex.ts` — `ipexJoinCommand`                                             | Pending |
| `packages/keri/src/app/cli/ipex.ts` — `sendPriorResponse`                                           | Pending |
| `packages/keri/src/app/cli/ipex.ts` — `waitForMultisigIpexCompletion`                               | Pending |
| `packages/keri/src/app/cli/multisig.ts` — `receiptAcceptedEvent`                                    | Pending |
| `packages/keri/src/app/cli/oobi.ts` — `oobiRequestCommand`                                          | Pending |
| `packages/keri/src/app/cli/rotate.ts` — `rotateCommand`                                             | Pending |
| `packages/keri/src/app/cli/vc.ts` — `vcRegistryInceptCommand`                                       | Pending |
| `packages/keri/src/app/cli/vc.ts` — `vcCreateCommand`                                               | Pending |
| `packages/keri/src/app/cli/vc.ts` — `vcRevokeCommand`                                               | Pending |
| `packages/keri/src/app/cli/verifier.ts` — `verifierRunCommand`                                      | Pending |
| `packages/keri/src/app/credential-workflows.ts` — `inceptCredentialRegistry`                        | Pending |
| `packages/keri/src/app/credential-workflows.ts` — `createCredential`                                | Pending |
| `packages/keri/src/app/credential-workflows.ts` — `importCredentialStream`                          | Pending |
| `packages/keri/src/app/credential-workflows.ts` — `revokeCredential`                                | Pending |
| `packages/keri/src/app/credential-workflows.ts` — `proposeGroupRegistryIncept`                      | Pending |
| `packages/keri/src/app/credential-workflows.ts` — `proposeGroupCredentialIssue`                     | Pending |
| `packages/keri/src/app/credential-workflows.ts` — `publishGroupVcProposal`                          | Pending |
| `packages/keri/src/app/delegating.ts` — `Anchorer`                                                  | Pending |
| `packages/keri/src/app/delegating.ts` — `Anchorer.constructor`                                      | Pending |
| `packages/keri/src/app/delegating.ts` — `Anchorer.begin`                                            | Pending |
| `packages/keri/src/app/delegating.ts` — `Anchorer.processAllOnce`                                   | Pending |
| `packages/keri/src/app/delegating.ts` — `Anchorer.processPartialWitnessEscrow`                      | Pending |
| `packages/keri/src/app/delegating.ts` — `Anchorer.publishDelegator`                                 | Pending |
| `packages/keri/src/app/endpoint-roleing.ts` — `proposeGroupEndpointRole`                            | Pending |
| `packages/keri/src/app/exchange-messaging.ts` — `ExchangeMessageArgs`                               | Pending |
| `packages/keri/src/app/exchange-messaging.ts` — `createExchangeMessage`                             | Pending |
| `packages/keri/src/app/exchange-messaging.ts` — `sendExchangeMessage`                               | Pending |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller`                                             | Pending |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.constructor`                                 | Pending |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.registerTopic`                               | Pending |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.pollDo`                                      | Pending |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.readLocalMailbox`                            | Pending |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.localCursor`                                 | Pending |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.pollRemoteEndpointOnce`                      | Pending |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.syncRemoteWorkers`                           | Pending |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.remoteEndpointWorker`                        | Pending |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.remotePollTargets`                           | Pending |
| `packages/keri/src/app/forwarding.ts` — `MailboxPoller.pollSignerHab`                               | Pending |
| `packages/keri/src/app/forwarding.ts` — `MailboxPollTarget`                                         | Pending |
| `packages/keri/src/app/forwarding.ts` — `buildForwardedDelivery`                                    | Pending |
| `packages/keri/src/app/forwarding.ts` — `mailboxReplyPayload`                                       | Pending |
| `packages/keri/src/app/forwarding.ts` — `introductionMessages`                                      | Pending |
| `packages/keri/src/app/forwarding.ts` — `[Symbol.iterator]`                                         | Pending |
| `packages/keri/src/app/forwarding.ts` — `introduce`                                                 | Pending |
| `packages/keri/src/app/forwarding.ts` — `remoteAlreadyReceiptedLatestEvent`                         | Pending |
| `packages/keri/src/app/forwarding.ts` — `defaultTopicForRoute`                                      | Pending |
| `packages/keri/src/app/forwarding.ts` — `pollMailboxTopic`                                          | Pending |
| `packages/keri/src/app/forwarding.ts` — `transportMailboxTopic`                                     | Pending |
| `packages/keri/src/app/forwarding.ts` — `mailboxTopicForRoute`                                      | Pending |
| `packages/keri/src/app/forwarding.ts` — `extractForwardedMessage`                                   | Pending |
| `packages/keri/src/app/forwarding.ts` — `embeddedSerderRaw`                                         | Pending |
| `packages/keri/src/app/forwarding.ts` — `forwardedAttachmentForPath`                                | Pending |
| `packages/keri/src/app/forwarding.ts` — `MailboxPollingTimeoutPolicy`                               | Pending |
| `packages/keri/src/app/forwarding.ts` — `MailboxPollBatch`                                          | Pending |
| `packages/keri/src/app/forwarding.ts` — `MailboxFetchTimeoutPolicy`                                 | Pending |
| `packages/keri/src/app/forwarding.ts` — `MailboxPollTransportRequest`                               | Pending |
| `packages/keri/src/app/forwarding.ts` — `MailboxPollTransport`                                      | Pending |
| `packages/keri/src/app/forwarding.ts` — `poll`                                                      | Pending |
| `packages/keri/src/app/forwarding.ts` — `fetchMailboxMessages`                                      | Pending |
| `packages/keri/src/app/forwarding.ts` — `fetchMailboxQueryResponse`                                 | Pending |
| `packages/keri/src/app/forwarding.ts` — `normalizeMailboxPollingTimeoutPolicy`                      | Pending |
| `packages/keri/src/app/forwarding.ts` — `mailboxFetchTimeoutPolicy`                                 | Pending |
| `packages/keri/src/app/forwarding.ts` — `positiveTimeoutMs`                                         | Pending |
| `packages/keri/src/app/httping.ts` — `requestWithHeaderTimeout`                                     | Pending |
| `packages/keri/src/app/ipex-credentialing.ts` — `processCredentialPresentationArtifacts`            | Pending |
| `packages/keri/src/app/ipex-grouping.ts` — `approveMultisigIpex`                                    | Pending |
| `packages/keri/src/app/ipex-grouping.ts` — `publishGroupIpexProposal`                               | Pending |
| `packages/keri/src/app/ipex-grouping.ts` — `findPendingMultisigIpex`                                | Pending |
| `packages/keri/src/app/ipex-grouping.ts` — `sendCompletedGroupIpex`                                 | Pending |
| `packages/keri/src/app/ipex-grouping.ts` — `sendCredentialBytes`                                    | Pending |
| `packages/keri/src/app/mailbox-sse.ts` — `MailboxSseMessage`                                        | Pending |
| `packages/keri/src/app/mailbox-sse.ts` — `MailboxSseOptions`                                        | Pending |
| `packages/keri/src/app/mailbox-sse.ts` — `eventMessage`                                             | Pending |
| `packages/keri/src/app/mailbox-sse.ts` — `appendBytes`                                              | Pending |
| `packages/keri/src/app/mailbox-sse.ts` — `consumeMailboxSse`                                        | Pending |
| `packages/keri/src/app/mailbox-sse.ts` — `readMailboxSseBody`                                       | Pending |
| `packages/keri/src/app/mailbox-sse.ts` — `parseMailboxSse`                                          | Pending |
| `packages/keri/src/app/mailbox-sse.ts` — `consumeChunks`                                            | Pending |
| `packages/keri/src/app/multisig-workflows.ts` — `publishProposal`                                   | Pending |
| `packages/keri/src/app/multisig-workflows.ts` — `publishVdrProposal`                                | Pending |
| `packages/keri/src/app/multisig-workflows.ts` — `registerAndSendProposal`                           | Pending |
| `packages/keri/src/app/multisig-workflows.ts` — `approveRpyProposal`                                | Pending |
| `packages/keri/src/app/multisig-workflows.ts` — `approveKelProposal`                                | Pending |
| `packages/keri/src/app/multisig-workflows.ts` — `approveVdrProposal`                                | Pending |
| `packages/keri/src/app/oobiery.ts` — `Oobiery`                                                      | Pending |
| `packages/keri/src/app/oobiery.ts` — `Oobiery.constructor`                                          | Pending |
| `packages/keri/src/app/oobiery.ts` — `Oobiery.registerReplyRoutes`                                  | Pending |
| `packages/keri/src/app/oobiery.ts` — `Oobiery.processJob`                                           | Pending |
| `packages/keri/src/app/oobiery.ts` — `Oobiery.processResponse`                                      | Pending |
| `packages/keri/src/app/oobiery.ts` — `Oobiery.resolveCesrOobiResponse`                              | Pending |
| `packages/keri/src/app/oobiery.ts` — `Oobiery.processReply`                                         | Pending |
| `packages/keri/src/app/oobiery.ts` — `readResponseBytes`                                            | Pending |
| `packages/keri/src/app/runtime-clock.ts` — `RuntimeTimer`                                           | Pending |
| `packages/keri/src/app/runtime-clock.ts` — `RuntimeClock`                                           | Pending |
| `packages/keri/src/app/verifier-agent.ts` — `VerifierAgentOptions`                                  | Pending |
| `packages/keri/src/app/verifier-agent.ts` — `VerifierAgent`                                         | Pending |
| `packages/keri/src/app/verifier-agent.ts` — `VerifierAgent.constructor`                             | Pending |
| `packages/keri/src/app/verifier-agent.ts` — `VerifierAgent.processOnce`                             | Pending |
| `packages/keri/src/app/verifier-agent.ts` — `VerifierAgent.scanAcceptedGrants`                      | Pending |
| `packages/keri/src/app/verifier-agent.ts` — `VerifierAgent.queueRevocation`                         | Pending |
| `packages/keri/src/app/verifier-agent.ts` — `VerifierAgent.scanPersistedRevocations`                | Pending |
| `packages/keri/src/app/verifier-agent.ts` — `VerifierAgent.postWebhook`                             | Pending |
| `packages/keri/src/app/verifier-agent.ts` — `VerifierAgent.expired`                                 | Pending |
| `packages/keri/src/app/verifier-agent.ts` — `nowDater`                                              | Pending |
| `packages/keri/src/app/witnessing.ts` — `readResponseBytes`                                         | Pending |
| `packages/keri/src/app/witnessing.ts` — `drainWitnessCues`                                          | Pending |
| `packages/keri/src/app/witnessing.ts` — `processWitnessIngressSource`                               | Pending |
| `packages/keri/src/app/witnessing.ts` — `processWitnessIngress`                                     | Pending |
| `packages/keri/src/app/witnessing.ts` — `sendWitnessMessage`                                        | Pending |
| `packages/keri/src/app/witnessing.ts` — `pollWitnessReceipt`                                        | Pending |
| `packages/keri/src/app/witnessing.ts` — `postWitnessReceiptEndpoint`                                | Pending |
| `packages/keri/src/app/witnessing.ts` — `getWitnessReceiptEndpoint`                                 | Pending |
| `packages/keri/src/app/witnessing.ts` — `Receiptor`                                                 | Pending |
| `packages/keri/src/app/witnessing.ts` — `Receiptor.constructor`                                     | Pending |
| `packages/keri/src/app/witnessing.ts` — `Receiptor.receiptOnce`                                     | Pending |
| `packages/keri/src/app/witnessing.ts` — `Receiptor.get`                                             | Pending |
| `packages/keri/src/app/witnessing.ts` — `Receiptor.catchup`                                         | Pending |
| `packages/keri/src/app/witnessing.ts` — `WitnessReceiptor`                                          | Pending |
| `packages/keri/src/app/witnessing.ts` — `WitnessReceiptor.constructor`                              | Pending |
| `packages/keri/src/did/webs/resolving.ts` — `resolveDidWebs`                                        | Pending |
| `packages/keri/src/did/webs/resolving.ts` — `resolveArtifacts`                                      | Pending |
| `packages/keri/src/did/webs/resolving.ts` — `artifactResponse`                                      | Pending |
| `packages/tufa/src/cli/dws.ts` — `dwsResolverCommand`                                               | Pending |
| `packages/tufa/src/cli/mailbox.ts` — `withMailboxWorkflow`                                          | Pending |
| `packages/tufa/src/cli/mailbox.ts` — `postMailboxAdminCesr`                                         | Pending |
| `packages/tufa/src/cli/mailbox.ts` — `postMailboxAdminMultipart`                                    | Pending |
| `packages/tufa/src/cli/witness.ts` — `witnessSubmitCommand`                                         | Pending |
| `packages/tufa/src/host/kernel.ts` — `runHostKernel`                                                | Pending |
| `packages/tufa/src/http/protocol/endpoints/did-resolution.ts` — `handleDidResolutionRoute`          | Pending |
| `packages/tufa/src/http/protocol/endpoints/generic-cesr-ingress.ts` — `deferredDirectQueryResponse` | Pending |
| `packages/tufa/src/http/protocol/endpoints/generic-cesr-ingress.ts` — `ingest`                      | Pending |
| `packages/tufa/src/http/protocol/runtime-bridge.ts` — `drainRuntimeCues`                            | Pending |
| `packages/tufa/src/operator/mailbox-debug.ts` — `fetchMailboxDebug`                                 | Pending |
| `packages/tufa/src/operator/mailbox-startup.ts` — `reconcileMailboxIdentity`                        | Pending |
| `packages/tufa/src/operator/witness-startup.ts` — `reconcileWitnessIdentity`                        | Pending |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxStreamOptions`                                | Pending |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector`                                     | Pending |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.constructor`                         | Pending |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.hasMailboxStore`                     | Pending |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.registerTopic`                       | Pending |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.registeredTopics`                    | Pending |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.close`                               | Pending |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.cursor`                              | Pending |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.retainQueryCue`                      | Pending |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.publish`                             | Pending |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.lastIndex`                           | Pending |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.topicIter`                           | Pending |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.streamMailbox`                       | Pending |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.mailboxStream`                       | Pending |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.start`                               | Pending |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.streamQueryResponse`                 | Pending |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.start`                               | Pending |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.remoteQueryCursor`                   | Pending |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.updateRemoteCursor`                  | Pending |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.hasQueryCue`                         | Pending |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.takeQueryCue`                        | Pending |
| `packages/keri/src/app/mailbox-director.ts` — `MailboxDirector.requireMailboxer`                    | Pending |
| `packages/keri/src/app/mailboxing.ts` — `mailboxerOptionsForHabery`                                 | Pending |
| `packages/keri/src/app/mailboxing.ts` — `openMailboxerForHabery`                                    | Pending |
| `packages/keri/src/app/mailboxing.ts` — `mailboxTopicKey`                                           | Pending |
| `packages/keri/src/app/mailboxing.ts` — `mailboxQueryTopics`                                        | Pending |
| `packages/keri/src/app/mailboxing.ts` — `updateMailboxRemoteCursor`                                 | Pending |
| `packages/keri/src/app/mailboxing.ts` — `mailboxPollEndpoints`                                      | Pending |
| `packages/keri/src/app/mailboxing.ts` — `mailboxDeliveryEndpoints`                                  | Pending |
| `packages/keri/src/app/mailboxing.ts` — `directDeliveryEndpoints`                                   | Pending |
| `packages/keri/src/app/mailboxing.ts` — `fetchEndpointUrls`                                         | Pending |
| `packages/keri/src/app/mailboxing.ts` — `HostedEndpoint`                                            | Pending |
| `packages/keri/src/app/mailboxing.ts` — `HostedEndpointPathMatch`                                   | Pending |
| `packages/keri/src/app/mailboxing.ts` — `HostedRouteResolution`                                     | Pending |
| `packages/keri/src/app/mailboxing.ts` — `hostedPrefixFilter`                                        | Pending |
| `packages/keri/src/app/mailboxing.ts` — `hostedEndpointMatches`                                     | Pending |
| `packages/keri/src/app/mailboxing.ts` — `hostedEndpointForPath`                                     | Pending |
| `packages/keri/src/app/mailboxing.ts` — `hostedEndpointPathMatches`                                 | Pending |
| `packages/keri/src/app/mailboxing.ts` — `resolveHostedEndpointPath`                                 | Pending |
| `packages/keri/src/app/mailboxing.ts` — `flattenRoleUrls`                                           | Pending |
| `packages/keri/src/app/mailboxing.ts` — `firstSortedEndpoint`                                       | Pending |
| `packages/keri/src/app/mailboxing.ts` — `preferredUrl`                                              | Pending |
| `packages/keri/src/app/mailboxing.ts` — `endpointBasePath`                                          | Pending |
| `packages/keri/src/app/mailboxing.ts` — `joinBasePath`                                              | Pending |
| `packages/keri/src/app/mailboxing.ts` — `normalizePath`                                             | Pending |
| `packages/keri/src/app/mailboxing.ts` — `relativeHostedPath`                                        | Pending |
| `packages/keri/src/app/mailboxing.ts` — `mailboxRemoteCursorRecord`                                 | Pending |
| `packages/keri/src/app/runtime-turn.ts` — `runtimeTurn`                                             | Pending |

## Retired declarations

ReplyCursor, CueEmission, Hab.interpretCue, RuntimeServices and the separate
tcp-conversation module were removed. No compatibility documentation is reintroduced.
