/**
 * Supported non-browser-safe KERI operations and data contracts.
 *
 * This curated surface serves library users and Tufa composition. Private
 * continuation state, handler installation, reply-slot bookkeeping and internal
 * constructor helpers stay in their owning implementation modules. Adding an
 * internal export must not silently expand this package contract.
 */
// Host lifecycle, direct ingress and concrete I/O boundaries.
export {
  Respondant,
} from "../app/delivery/respondant.ts";
export {
  type DispatchResult,
  envelopeFromFrame,
  queryEnvelopeFromDispatch,
} from "../app/protocol/parsering.ts";
export {
  type ProtocolHostPolicy,
} from "../app/protocol/protocol-host-policy.ts";
export {
  createProtocolProcessor,
  type DispatchOptions,
  type ProtocolDispatchResult,
  ProtocolProcessor,
} from "../app/protocol/protocol-processing.ts";
export {
  Reactor,
} from "../app/protocol/reactor.ts";
export type { QueryReply } from "../app/queries/query-replies.ts";
export {
  abortable,
  rethrowCleanupFailure,
} from "../app/runtime/abortable.ts";
export {
  type AgentRuntime,
  type AgentRuntimeOptions,
  createAgentRuntime,
  runAgentRuntime,
  runAgentRuntimeUntil,
  runtimeOobiConverged,
  settleMailboxPollBatch,
  settleRuntimeIngress,
} from "../app/runtime/agent-runtime.ts";
export {
  cueDo,
  processCuesOnce,
} from "../app/runtime/cue-runtime.ts";
export {
  chunkBytes,
  collectBytes,
  fileBytes,
  type SourceOptions,
} from "../app/transport/byte-source.ts";
export {
  CesrHttpRefusal,
  type CesrPostResult,
  type EgressOptions,
  postCesr,
  requestFrame,
} from "../app/transport/cesr-egress.ts";
export {
  buildCesrRequest,
  buildCesrStreamRequest,
  CESR_ATTACHMENT_HEADER,
  CESR_CONTENT_TYPE,
  CESR_DESTINATION_HEADER,
  type CesrStreamInspection,
  isCesrContentType,
  isMultipartFormContentType,
  KERIPY_CESR_JSON_CONTENT_TYPE,
  type MailboxAdminRequest,
  MULTIPART_CONTENT_TYPE,
  readCesrRequestBytes,
  readMailboxAdminRequest,
  readRequiredCesrRequestBytes,
  requestBytes,
} from "../app/transport/cesr-http.ts";
export {
  FetchHttpClient,
  type HttpClient,
  type HttpRequestInit,
  type HttpResponse,
  type HttpStreamResponse,
} from "../app/transport/http-client.ts";

export {
  socketBytes,
  type SocketSourceOptions,
} from "../app/transport/socket-source.ts";
export {
  TCPMessenger,
  type TCPMessengerOptions,
} from "../app/transport/tcp-messenger.ts";

export {
  openTcpConnection,
  sendCesrTcp,
  sendCesrTcpFrame,
  sendCesrTcpSocket,
  streamCesrTcp,
  type TcpConnection,
  type TcpSendOptions,
  type TcpSocketWriteOptions,
  type TcpSourceFactory,
  writeCesrTcpSocket,
} from "../app/transport/tcp-egress.ts";
export { TransportError } from "../app/transport/transport-error.ts";
// Controller state, credentials and protocol operations.
export { type AcdcGraph, type AcdcRelationIssue, evaluateAcdcRelations } from "../acdc/graphing.ts";
export {
  Oobiery,
  oobiRequestExn,
} from "../app/bootstrap/oobiery.ts";
export {
  type CredentialImportResult,
  importCredentialStream,
} from "../app/credentials/credential-importing.ts";
export {
  type CredentialRevokeOptions,
  type CredentialRevokeResult,
  deliverCredentialRevocation,
  revokeCredential,
} from "../app/credentials/credential-revoking.ts";
export {
  createCredential,
  type CredentialCreateOptions,
  type CredentialExportResult,
  type CredentialListItem,
  type CredentialListOptions,
  type CredentialRegistryInceptOptions,
  credentialRegistryRecords,
  credentialRegistryStatus,
  exportCredentialStream,
  inceptCredentialRegistry,
  type IssueResult,
  listCredentials,
  pinSchemaBytes,
  type RegistryResult,
} from "../app/credentials/credential-workflows.ts";
export {
  Poster,
  type PosterEvent,
  type PosterMsg,
  type PosterOutcome,
  type PosterStream,
} from "../app/delivery/forwarding.ts";
export {
  type EssrDecision,
  type EssrMessage,
  EssrRecipient,
} from "../app/exchanges/essr.ts";
export {
  createExchangeMessage,
  type ExchangeMessageArgs,
  sendExchangeMessage,
} from "../app/exchanges/exchange-messaging.ts";
export {
  type ExchangeAttachment,
  type ExchangeDecision,
  type ExchangeInput,
  Exchanger,
  type ExchangeRouteHandler,
  type ExchangeRouteVerification,
} from "../app/exchanges/exchanging.ts";
export {
  type ChallengeResponsePayload,
  findVerifiedChallengeResponse,
  generateChallengeWords,
  markChallengeVerified,
  parseChallengeWords,
} from "../app/identity/challenging.ts";
export {
  Configer,
  type ConfigerOptions,
  createConfiger,
} from "../app/identity/configing.ts";
export {
  Anchorer,
  type DelegationPhase,
  type DelegationWorkflowResult,
  type DelegationWorkflowStatus,
} from "../app/identity/delegating.ts";
export {
  endpointRoleAccepted,
  type GroupRoleResult,
  loadAcceptedEndpointRole,
  proposeGroupEndpointRole,
} from "../app/identity/endpoint-roleing.ts";
export {
  createHabery,
  type GroupHabCreation,
  type GroupHabInteraction,
  type GroupHabRotation,
  Hab,
  Habery,
  type HaberyArgs,
  type MakeGroupHabArgs,
  type MakeHabArgs,
} from "../app/identity/habbing.ts";
export {
  Algos,
  Manager,
  type ManagerArgs,
  type ManagerDecryptArgs,
  type ManagerInceptArgs,
  type ManagerIngestArgs,
  type ManagerReplayArgs,
  type ManagerRotateArgs,
  type ManagerSignArgs,
  type SigningPath,
} from "../app/identity/keeping.ts";
export {
  type ContactRecord,
  Organizer,
} from "../app/identity/organizing.ts";
export { ipexExnBody } from "../app/ipex/ipex-building.ts";
export {
  type CredentialAdmitMessage,
  type CredentialArtifact,
  type CredentialGrantMessage,
  type CredentialPresentationArtifacts,
  credentialPresentationArtifacts,
  credentialSaidFromGrant,
  ipexCredentialAdmit,
  type IpexCredentialAdmitOptions,
  ipexCredentialGrant,
  type IpexCredentialGrantOptions,
  processCredentialPresentationArtifacts,
  storedGrantArtifacts,
} from "../app/ipex/ipex-credentialing.ts";
export { type IpexGraph, walkIpexGraph } from "../app/ipex/ipex-graph.ts";
export type { DisclosurePlan } from "../app/ipex/ipex-graph.ts";
export {
  acceptedRegistryEvidence,
  authenticateIpexNode,
  type IpexNodeAuthentication,
} from "../app/ipex/ipex-node-authentication.ts";
export {
  IPEX_GRANT_ROUTE,
  IPEX_ROUTES,
  ipexAdmitExn,
  ipexAgreeExn,
  ipexApplyExn,
  type IpexBuilderOptions,
  ipexGrantExn,
  type IpexGrantOptions,
  type IpexMessage,
  ipexOfferExn,
  type IpexRoute,
  ipexSpurnExn,
} from "../app/ipex/ipexing.ts";
export {
  MailboxDirector,
} from "../app/mailbox/mailbox-director.ts";
export {
  type MailboxFetchTimeoutPolicy,
  type MailboxPollBatch,
  MailboxPoller,
  type MailboxPollingTimeoutPolicy,
} from "../app/mailbox/mailbox-poller.ts";
export {
  consumeMailboxSse,
  type MailboxSseMessage,
  type MailboxSseOptions,
  parseMailboxSse,
  readMailboxSseBody,
} from "../app/mailbox/mailbox-sse.ts";
export {
  endpointBasePath,
  fetchEndpointUrls,
  type HostedEndpoint,
  type HostedEndpointPathMatch,
  type HostedRouteResolution,
  mailboxPollEndpoints,
  mailboxQueryTopics,
  mailboxTopicKey,
  preferredUrl,
  resolveHostedEndpointPath,
} from "../app/mailbox/mailboxing.ts";
export { isLocalGroupHab } from "../app/multisig/group-members.ts";
export {
  Multiplexor,
  MULTISIG_ROUTES,
  type MultisigBuilderOptions,
  type MultisigEventProposal,
  multisigExn,
  multisigInceptExn,
  multisigInteractExn,
  multisigIssueExn,
  type MultisigMessage,
  multisigRegistryInceptExn,
  multisigRevokeExn,
  multisigRotateExn,
  type MultisigRoute,
  multisigRpyExn,
} from "../app/multisig/grouping.ts";
export type {
  GroupMessageRef,
  GroupSendResult,
} from "../app/multisig/multisig-messaging.ts";
export {
  Notifier,
} from "../app/notifications/notifying.ts";
export {
  Signal,
  Signaler,
} from "../app/notifications/signaling.ts";
export { RawRecord } from "../core/records.ts";

export {
  type CredentialStateProvider,
  Verifier,
  type VerifierCue,
  type VerifierDecision,
  type VerifierEscrowReason,
  type VerifierOptions,
  type VerifierRejectReason,
} from "../app/credentials/verifying.ts";
export {
  witnessKeyStateGet,
  type WitnessKeyStateGetResult,
  witnessQueryGet,
  type WitnessQueryGetResult,
  witnessReceiptGet,
  type WitnessReceiptGetResult,
  witnessReceiptPost,
  type WitnessReceiptPostResult,
} from "../app/witness/http-endpoints.ts";
export {
  drainWitnessCues,
  processWitnessIngress,
  processWitnessIngressSource,
  type WitnessIngressOptions,
} from "../app/witness/ingress.ts";
export { type WitnessReceiptEndpointResponse } from "../app/witness/receipt-client.ts";
export {
  Receiptor,
  type WitnessAuthMap,
  WitnessReceiptor,
  type WitnessReceiptRunResult,
} from "../app/witness/receipting.ts";
export {
  BUILD_METADATA,
  DISPLAY_VERSION,
  PACKAGE_VERSION,
} from "../version.ts";
// Pure protocol construction and typed evidence.
export {
  acdcagg,
  type AcdcAggregateOptions,
  acdcatt,
  type AcdcAttributeOptions,
  acdcmap,
  type AcdcMapOptions,
  acgSchemaDefault,
  acmSchemaDefault,
  actSchemaDefault,
  blindate,
  type BlindateOptions,
  type DefaultSchemaResult,
  regcept,
  type RegceptOptions,
  sectaggr,
  sectattr,
  sectedge,
  sectionate,
  type SectionateOptions,
  type SectionateResult,
  sectrule,
  sectschema,
  update,
  type UpdateOptions,
} from "../acdc/messaging.ts";
export {
  RegistryObserver,
  type RegistryObserverDecision,
} from "../acdc/observing.ts";
export {
  type RegistryBindingEvidence,
  type RegistryDisclosure,
  type RegistryEvidence,
  type RegistryRefusal,
  type RegistryState,
  type RegistryVerification,
  vet,
  vetBinds,
  vetBlind,
} from "../acdc/regeventing.ts";
export { publishPendingTel } from "../app/credentials/tel-publishing.ts";
export {
  type AgentCue,
  type CredentialRevokedCue,
  type CredentialSavedCue,
  type InvalidCue,
  type KelQueryFields,
  type KeyStateSavedCue,
  type NoticeBadCloneFNCue,
  type NoticeCue,
  type OobiFailedCue,
  type OobiQueuedCue,
  type OobiResolvedCue,
  type PartialSigUnescrowCue,
  type ProofCue,
  type QueryCue,
  type QueryInstruction,
  type QueryRequest,
  type ReceiptCue,
  type RemoteMemberedSigCue,
  type ReplayCue,
  type ReplyCue,
  type StreamCue,
  type TelQueryCue,
  type TransactionStateSavedCue,
  type WitnessCue,
} from "../core/cues.ts";
export { Deck } from "../core/deck.ts";
export type { KeriDispatchEnvelope, TransIdxSigGroup } from "../core/dispatch.ts";
export {
  AppError,
  DatabaseError,
  DatabaseKeyError,
  DatabaseNotOpenError,
  DatabaseOperationError,
  InvalidPathNameError,
  PathError,
  ValidationError,
} from "../core/errors.ts";
export { exchange } from "../core/exchange/protocol-exchanging.ts";
export {
  type KeverEventEnvelope,
  Kevery,
  type MessagePolicy,
  type QueryEnvelope,
  type ReceiptEnvelope,
} from "../core/kel/eventing.ts";
export {
  Kever,
  type KeverEventInit,
  type KeverStateInit,
  type LastEstLoc,
} from "../core/kel/kever.ts";
export {
  consoleLogger,
  getLogLevel,
  LOG_LEVELS,
  type Logger,
  type LogLevel,
  noopLogger,
  setLogLevel,
} from "../core/logger.ts";
export { type KramConfig, Kramer, type KramRefusal } from "../core/mailbox/kraming.ts";
export {
  CREDENTIAL_MAILBOX_TOPIC,
  DELEGATE_MAILBOX_TOPIC,
  type MbxTopicCursor,
  type MbxTopics,
  type MbxTopicSpec,
  normalizeMbxTopicCursor,
  OOBI_MAILBOX_TOPIC,
  RECEIPT_MAILBOX_TOPIC,
  REPLAY_MAILBOX_TOPIC,
  REPLY_MAILBOX_TOPIC,
} from "../core/mailbox/mailbox-topics.ts";
export { incept, interact, query, reply, rotate } from "../core/protocol-eventing.ts";
export { messagize } from "../core/protocol-serialization.ts";
export { incept as inceptRegistry, issue, revoke } from "../core/protocol-vdr-eventing.ts";
export {
  type BlindedImageTuple,
  type BlindedStateQuadrupleTuple,
  type BoundStateSextuple,
  CacheTypeRecord,
  type CacheTypeRecordShape,
  type CredentialKelAnchor,
  EndAuthRecord,
  type EndAuthRecordShape,
  EndpointRecord,
  type EndpointRecordShape,
  type EscrowedValidatorReceiptQuintuple,
  type EventSealTuple,
  EventSourceRecord,
  type EventSourceRecordShape,
  type FirstSeenReplayCouple,
  type GroupMemberTuple,
  HabitatRecord,
  type HabitatRecordShape,
  KeyStateRecord,
  type KeyStateRecordShape,
  LocationRecord,
  type LocationRecordShape,
  MsgCacheRecord,
  type MsgCacheRecordShape,
  ObservedRecord,
  type ObservedRecordShape,
  OobiQueryRecord,
  type OobiQueryRecordShape,
  OobiRecord,
  type OobiRecordShape,
  type ReceiptCouple,
  RegistryRecord,
  type RegistryRecordShape,
  type RegistrySealFields,
  RegStateRecord,
  type RegStateRecordShape,
  type SourceSealTriple,
  StateEERecord,
  type StateEERecordShape,
  TopicsRecord,
  type TopicsRecordShape,
  TxnMsgCacheRecord,
  type TxnMsgCacheRecordShape,
  type TypedDigestSealCouple,
  type TypedMediaQuadrupleTuple,
  type UnverifiedReceiptTriple,
  type ValidatorReceiptQuadruple,
  VcStateRecord,
  type VcStateRecordShape,
  type VerferCigarCouple,
  WellKnownAuthN,
  type WellKnownAuthNShape,
} from "../core/records.ts";
export {
  type EndpointRole,
  EndpointRoles,
  isEndpointRole,
  isRole,
  type Role,
  Roles,
} from "../core/roles.ts";
export {
  isScheme,
  type Scheme,
  Schemes,
} from "../core/schemes.ts";
export {
  dumpSchema,
  Schemer,
  type SchemerInit,
} from "../core/scheming.ts";
export { UnsupportedTelReplayError } from "../db/replay/tel-replay.ts";
export {
  type AnchorSeal,
  credential,
  type CredentialBuildOptions,
  Credentialer,
  type CredentialerOptions,
  type CredentialIssueResult,
  CredentialWallet,
  Regery,
  type RegeryOptions,
  Registry,
  type RegistryInceptOptions,
  type RegistryOptions,
  serializeCredential,
} from "../vdr/credentialing.ts";
export {
  type TelProcessDecision,
  type TelProcessEventArgs,
  type TelQueryDecision,
  Tever,
  type TeverOptions,
  Tevery,
  type TeveryOptions,
} from "../vdr/eventing.ts";
export { TelPublication, type TelPublicationTarget } from "../vdr/tel-publication.ts";
// Accepted-state DID projection and artifact operations.
export {
  resolveDidKeri,
  type ResolveDidKeriResult,
} from "../did/keri/resolving.ts";
export {
  type DidWebsArtifacts,
  type DidWebsJsonArtifact,
  generateDidWebsArtifacts,
  type GenerateDidWebsArtifactsOptions,
  generateDidWebsCesr,
  generateDidWebsJson,
} from "../did/webs/artifacts.ts";
export {
  type ActiveDesignatedAliasCredential,
  bindDesignatedAliases,
  type BindDesignatedAliasesOptions,
  type BindDesignatedAliasesResult,
  DESIGNATED_ALIASES_SCHEMA_SAID,
  listActiveDesignatedAliasCredentials,
} from "../did/webs/designated-aliases.ts";
export {
  type DidMethod,
  type DidQueryParts,
  type DidWebsArtifactUrls,
  didWebsArtifactUrls,
  didWebsFromArtifactRequest,
  type ParsedDid,
  type ParsedDidKeri,
  type ParsedDidWebs,
  parseDid,
  parseDidKeriIdentifier,
  parseDidWebs,
  toCanonicalDidWebs,
  toHostedDidWeb,
} from "../did/webs/dids.ts";
export {
  type DidDocument,
  type DidDocumentOptions,
  didResolutionError,
  type DidResolutionResult,
  didResolutionResult,
  generateBareDidDocument,
  generateDidDocument,
} from "../did/webs/documenting.ts";
export {
  resolveDidWebs,
  type ResolveDidWebsOptions,
  type ResolveDidWebsResult,
} from "../did/webs/resolving.ts";
export {
  makeNowIso8601,
} from "../time/mod.ts";

export { HTTPMessenger, type HTTPMessengerOptions } from "../app/transport/http-messenger.ts";
export { HTTPStreamMessenger } from "../app/transport/http-stream-messenger.ts";
export type { IngressOptions } from "../app/transport/message-source.ts";
export { messengerFrom, type MessengerUrls, streamMessengerFrom } from "../app/transport/messengering.ts";
export { TCPStreamMessenger } from "../app/transport/tcp-stream-messenger.ts";

export { type RuntimeClock, systemClock } from "../app/runtime/runtime-clock.ts";

export { AnchorQuerier, KeyStateNoticer, LogQuerier, SeqNoQuerier } from "../app/queries/querying.ts";
export { WitnessInquisitor } from "../app/queries/witness-inquisitor.ts";
