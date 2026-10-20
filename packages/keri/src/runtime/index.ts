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
  abortable,
  rethrowCleanupFailure,
} from "../app/abortable.ts";
export {
  type AgentRuntime,
  type AgentRuntimeOptions,
  createAgentRuntime,
  runAgentRuntime,
  runAgentRuntimeUntil,
  runtimeOobiConverged,
  settleMailboxPollBatch,
  settleRuntimeIngress,
} from "../app/agent-runtime.ts";
export {
  chunkBytes,
  collectBytes,
  fileBytes,
  type SourceOptions,
} from "../app/byte-source.ts";
export {
  CesrHttpRefusal,
  type CesrPostResult,
  type EgressOptions,
  postCesr,
  requestFrame,
} from "../app/cesr-egress.ts";
export {
  buildCesrRequest,
  buildCesrStreamRequest,
  CESR_ATTACHMENT_HEADER,
  CESR_CONTENT_TYPE,
  CESR_DESTINATION_HEADER,
  type CesrBodyMode,
  type CesrStreamInspection,
  DEFAULT_CESR_BODY_MODE,
  isCesrContentType,
  isMultipartFormContentType,
  KERIPY_CESR_JSON_CONTENT_TYPE,
  type MailboxAdminRequest,
  MULTIPART_CONTENT_TYPE,
  normalizeCesrBodyMode,
  readCesrRequestBytes,
  readMailboxAdminRequest,
  readRequiredCesrRequestBytes,
  requestBytes,
} from "../app/cesr-http.ts";
export {
  cueDo,
  processCuesOnce,
} from "../app/cue-runtime.ts";
export {
  FetchHttpClient,
  type HttpClient,
  type HttpRequestInit,
  type HttpResponse,
  type HttpStreamResponse,
} from "../app/http-client.ts";
export {
  type DispatchResult,
  envelopeFromFrame,
  queryEnvelopeFromDispatch,
} from "../app/parsering.ts";
export {
  type ProtocolHostPolicy,
} from "../app/protocol-host-policy.ts";
export {
  createProtocolProcessor,
  type DispatchOptions,
  type ProtocolDispatchResult,
  ProtocolProcessor,
} from "../app/protocol-processing.ts";
export type { QueryReply } from "../app/query-replies.ts";
export {
  Reactor,
} from "../app/reactor.ts";
export {
  Respondant,
} from "../app/respondant.ts";

export {
  socketBytes,
  type SocketSourceOptions,
} from "../app/socket-source.ts";
export {
  type TCPConversation,
  TCPMessenger,
  type TCPMessengerOptions,
  type TCPMessengerResult,
} from "../app/tcp-messenger.ts";

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
  type TcpTransmission,
  writeCesrTcpSocket,
} from "../app/tcp-egress.ts";
export { TransportError } from "../app/transport-error.ts";
// Controller state, credentials and protocol operations.
export {
  type ChallengeResponsePayload,
  findVerifiedChallengeResponse,
  generateChallengeWords,
  markChallengeVerified,
  parseChallengeWords,
} from "../app/challenging.ts";
export {
  Configer,
  type ConfigerOptions,
  createConfiger,
} from "../app/configing.ts";
export {
  createCredential,
  type CredentialCreateOptions,
  type CredentialCreateResult,
  type CredentialExportResult,
  type CredentialImportResult,
  type CredentialListItem,
  type CredentialListOptions,
  type CredentialRegistryInceptOptions,
  credentialRegistryRecords,
  credentialRegistryStatus,
  type CredentialRevokeOptions,
  type CredentialRevokeResult,
  exportCredentialStream,
  importCredentialStream,
  inceptCredentialRegistry,
  listCredentials,
  pinSchemaBytes,
  revokeCredential,
} from "../app/credential-workflows.ts";
export {
  Anchorer,
  type DelegationPhase,
  type DelegationWorkflowResult,
  type DelegationWorkflowStatus,
} from "../app/delegating.ts";
export {
  endpointRoleAccepted,
  type GroupEndpointRoleProposalResult,
  loadAcceptedEndpointRole,
  proposeGroupEndpointRole,
} from "../app/endpoint-roleing.ts";
export {
  type EssrDecision,
  type EssrMessage,
  EssrRecipient,
} from "../app/essr.ts";
export {
  createExchangeMessage,
  type ExchangeMessageArgs,
  sendExchangeMessage,
} from "../app/exchange-messaging.ts";
export {
  type ExchangeAttachment,
  type ExchangeDecision,
  type ExchangeInput,
  Exchanger,
  type ExchangeRouteHandler,
  type ExchangeRouteVerification,
} from "../app/exchanging.ts";
export {
  type ExchangeDeliveryPreference,
  type MailboxFetchTimeoutPolicy,
  type MailboxPollBatch,
  MailboxPoller,
  type MailboxPollingTimeoutPolicy,
  Poster,
  type PosterEvent,
  type PosterOutcome,
} from "../app/forwarding.ts";
export { isLocalGroupHab } from "../app/group-members.ts";
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
} from "../app/grouping.ts";
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
} from "../app/habbing.ts";
export {
  type CredentialAdmitMessage,
  type CredentialArtifact,
  type CredentialGrantMessage,
  type CredentialPresentationArtifacts,
  credentialPresentationArtifacts,
  ipexCredentialAdmit,
  type IpexCredentialAdmitOptions,
  ipexCredentialGrant,
  type IpexCredentialGrantOptions,
  processCredentialPresentationArtifacts,
} from "../app/ipex-credentialing.ts";
export type { DisclosurePlan } from "../app/ipex-graph.ts";
export {
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
} from "../app/ipexing.ts";
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
} from "../app/keeping.ts";
export {
  MailboxDirector,
} from "../app/mailbox-director.ts";
export {
  consumeMailboxSse,
  type MailboxSseMessage,
  type MailboxSseOptions,
  parseMailboxSse,
  readMailboxSseBody,
} from "../app/mailbox-sse.ts";
export {
  directDeliveryEndpoints,
  endpointBasePath,
  fetchEndpointUrls,
  type HostedEndpoint,
  type HostedEndpointPathMatch,
  type HostedRouteResolution,
  mailboxDeliveryEndpoints,
  mailboxPollEndpoints,
  mailboxQueryTopics,
  mailboxTopicKey,
  preferredUrl,
  resolveHostedEndpointPath,
} from "../app/mailboxing.ts";
export {
  Notifier,
} from "../app/notifying.ts";
export {
  Oobiery,
  oobiRequestExn,
} from "../app/oobiery.ts";
export {
  type ContactRecord,
  Organizer,
} from "../app/organizing.ts";
export {
  Signal,
  Signaler,
} from "../app/signaling.ts";
export {
  VerifierAgent,
  type VerifierAgentOptions,
  type VerifierAgentProcessResult,
  type VerifierBusinessValidator,
  type VerifierBusinessValidatorContext,
  type VerifierWebhookBody,
} from "../app/verifier-agent.ts";
export {
  type CredentialStateProvider,
  Verifier,
  type VerifierCue,
  type VerifierDecision,
  type VerifierEscrowReason,
  type VerifierOptions,
  type VerifierRejectReason,
} from "../app/verifying.ts";
export {
  BUILD_METADATA,
  DISPLAY_VERSION,
  PACKAGE_VERSION,
} from "../app/version.ts";
export {
  drainWitnessCues,
  processWitnessIngress,
  processWitnessIngressSource,
  Receiptor,
  type WitnessAuthMap,
  type WitnessIngressOptions,
  witnessKeyStateGet,
  type WitnessKeyStateGetResult,
  witnessQueryGet,
  type WitnessQueryGetResult,
  type WitnessReceiptEndpointResponse,
  witnessReceiptGet,
  type WitnessReceiptGetResult,
  WitnessReceiptor,
  witnessReceiptPost,
  type WitnessReceiptPostResult,
  type WitnessReceiptRunResult,
} from "../app/witnessing.ts";
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
} from "../acdc/regeventing.ts";
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
export {
  type KeverEventEnvelope,
  Kevery,
  type MessagePolicy,
  type QueryEnvelope,
  type ReceiptEnvelope,
} from "../core/eventing.ts";
export {
  Kever,
  type KeverEventInit,
  type KeverStateInit,
  type LastEstLoc,
} from "../core/kever.ts";
export { type KramConfig, Kramer, type KramRefusal } from "../core/kraming.ts";
export {
  consoleLogger,
  getLogLevel,
  LOG_LEVELS,
  type Logger,
  type LogLevel,
  noopLogger,
  setLogLevel,
} from "../core/logger.ts";
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
} from "../core/mailbox-topics.ts";
export { incept, interact, query, reply, rotate } from "../core/protocol-eventing.ts";
export { exchange } from "../core/protocol-exchanging.ts";
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

export { HTTPMessenger, type HTTPMessengerOptions } from "../app/http-messenger.ts";
export type { IngressOptions } from "../app/message-source.ts";

export { type RuntimeClock, systemClock } from "../app/runtime-clock.ts";
