# Explicit ordinary and stream messengers

Status: approved release-goal supplement; implementation and qualification pending.
Date: 2026-10-20.

## Decision and scope

Remove the persisted CESR body preference completely. Ordinary versus stream
delivery is a component construction decision with a concrete wire contract.
It is not identity state, a Habery setting, a protocol-version selector, or a
user preference.

Implement the responsibilities represented by KERIpy's `messengerFrom`,
`streamMessengerFrom`, `HTTPMessenger`, `HTTPStreamMessenger`, and TCP
counterparts. Preserve the existing single Poster worker and explicit operations.
Do not reproduce HIO scheduling machinery in Effection or introduce a second
delivery queue.

Kent explicitly requested incorporation into the active release goal. The
[release plan](../V2_RELEASE_COMPLETION_PLAN.md) adopts this work as PRs 13a–13c,
next after the initial typed publication refactor and before expanding multisig
CLI/IPEX behavior. This supplement records source analysis and required work,
not completed implementation or qualification. Preserve existing main-task work.
Native-v2 CLI assertions are completed with the later authoring/IPEX features;
early transport checks do not qualify features that have not been implemented.

## Source baseline and findings

The inspected keri-ts HEAD was
`b2d16d74b0722296198110206a25632f087304b7`. Main-task changes in grouping,
multisig publication, credential workflows, CLI, and tests were present during
inspection. Re-read those callers before implementation; the symbol map below
is a navigation aid rather than a promise that line numbers will remain stable.

KERIpy sources inspected:

| Reference                            | Commit                                     | Purpose                                     |
| ------------------------------------ | ------------------------------------------ | ------------------------------------------- |
| Local frozen reference               | `7143832813cac6a394ab1faf9be83bb3372be87c` | Existing repository reconciliation baseline |
| Release profile `main`               | `424a50c03421165c5f289e07a341bd57b8d8ab78` | Native-v2 reference behavior                |
| Release profile `1.2` / GLEIF 1.2.17 | `b8626e1d58770a4a480ea72a01acc5580278a9f2` | Accepted legacy target with stabilized TCP  |
| Release profile `1.3` / 1.3.6        | `4ce4cc79e06653f77342be1bf604086b89b1f090` | Legacy peer behavior                        |

The original three release-profile cache checkouts had matching HEADs, and the inspected
`agenting.py`, `forwarding.py`, `httping.py`, and `indirecting.py` bytes matched
their Git objects. These are source observations, not runtime qualification.
Use `scripts/ci/keripy-reference.json` and
`docs/plans/qualification/REFERENCE_ENVIRONMENTS.md` for actual interpreter,
dependency, and imported-source checks. The mailbox fork remains a separately
labeled environment; its passing tests cannot stand in for unmodified upstream.

Ten current-state findings:

1. KERIpy ordinary HTTP delivery splits a sequence into signed-message POSTs,
   carrying attachments in `CESR-ATTACHMENT`.
2. KERIpy stream HTTP delivery sends the prepared bytes in one PUT with
   `Content-Type: application/cesr` and `CESR-DESTINATION`.
3. KERIpy's `streamCESRRequests` belongs to the ordinary POST implementation.
   Its name does not mean `HTTPStreamMessenger`.
4. Our `HTTPMessenger.stream()` iterates a byte source through the ordinary
   frame parser. It is not the Python stream messenger.
5. Our `bodyMode: "body"` still takes the frame-splitting POST path. It therefore
   fails to represent the whole-stream PUT contract even when bytes are in the body.
6. Poster already distinguishes ordinary and stream admissions for routing,
   but both currently reach the same HTTP messenger.
7. Initial IPEX grant/admit/spurn paths already have stream admissions in
   keri-ts. Their transport still needs correction. KERIpy's join path
   deliberately uses ordinary Poster delivery.
8. Query and mailbox-polling requests inherit the Habery preference today.
   Their Python counterparts explicitly make ordinary signed POST requests.
9. Both TCP messenger kinds send raw CESR bytes. The distinction must not
   introduce HTTP framing or duplicate the socket implementation.
10. The pinned main and 1.3 Python stream factories omit TCP payload admission;
    1.2.14 admits it. Match the working contract, not that omission.

The 1.2.x target now uses unmodified GLEIF-IT/keripy v1.2.17 and its required
`gleif-hio==0.6.21`. The original WebOfTrust 1.2.14 pin
`bab95c16e949b61398129a3e41a8f68bad84c94f` discarded 868 queued bytes at
Directant EOF before creating a Reactant in the transport probe; it is no longer
the release compatibility target. Preserve that limitation rather than attributing
the fork fix to the original pin. Main/1.3 factory limitations above remain.

Primary Python navigation:

| Source / symbols                                                                | Responsibility to preserve                                   |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `src/keri/app/agenting.py`: `messenger`, `messengerFrom`, `streamMessengerFrom` | Endpoint lookup versus concrete transport construction       |
| Same file: `HTTPMessenger.msgDo`, `responseDo`                                  | Ordinary POST generation and response capture                |
| Same file: `HTTPStreamMessenger.__init__`, `recur`                              | One raw PUT and its response                                 |
| Same file: `TCPMessenger`, `TCPStreamMessenger`                                 | Raw output, concurrent receive parsing, actual send progress |
| `src/keri/app/httping.py`: `createCESRRequest`, `streamCESRRequests`            | Signed POST framing; optional specialized path               |
| `src/keri/app/forwarding.py`: `Poster`, `StreamPoster`                          | Distinct route selection and message preparation             |
| `src/keri/app/indirecting.py`: `Poller.eventDo`, `HttpEnd.on_post`, `on_put`    | Signed mailbox query/SSE; ordinary and whole-stream ingress  |
| `src/keri/cli/commands/ipex/{grant,admit,spurn,join}.py`                        | Initial stream delivery versus ordinary join completion      |

For review, the pinned [agenting source](https://github.com/WebOfTrust/keripy/blob/424a50c03421165c5f289e07a341bd57b8d8ab78/src/keri/app/agenting.py)
and [forwarding source](https://github.com/WebOfTrust/keripy/blob/424a50c03421165c5f289e07a341bd57b8d8ab78/src/keri/app/forwarding.py)
are stable reference links.

## Target responsibilities and contracts

### Construction chooses the operation

Provide two small factories named `messengerFrom` and `streamMessengerFrom`.
They select a concrete HTTP(S) or TCP messenger from already resolved endpoint
URLs. They do not resolve roles, look up unrelated stores, inspect global
preferences, or choose KERI/ACDC/CESR versions.

- Ordinary construction binds endpoint, destination, authentication headers,
  and actual transport capabilities. Its operation accepts prepared message bytes.
- Stream construction additionally binds the finite, ordered payload for one
  delivery. Its operation sends that payload once.
- Construction has no network or storage effects. Effection operations own I/O,
  cancellation, completion, and joined cleanup.
- Preserve HTTPS before HTTP before TCP, matching current keri-ts and the main
  reference. The older references prefer HTTP when both HTTP schemes exist;
  this does not justify a version-dependent selection setting.
- Fail before I/O when no usable endpoint exists. Validate that an advertised
  scheme agrees with its URL. Do not silently downgrade after a failed attempt.
- Preserve the resolved destination endpoint AID and authentication through each
  request. A forwarding provider's destination is not automatically the final
  business recipient.

Prefer a small `messengering.ts` factory module alongside the concrete messenger
modules, or the equivalent cohesive location after the main task's package
reorganization. Do not create a transport registry, base-class hierarchy, factory
injection framework, or generic request/response bus. Share only actual HTTP
request ownership, header construction, and TCP socket mechanics.

Use the repository's existing operation naming consistently. `msgDo` and
`receiptDo` are appropriate where their meanings match Python; a new naming
framework or a second scheduler is not.

### Ordinary HTTP

`HTTPMessenger` owns signed-message POST delivery. Each ordinary frame has its
original signed body in the HTTP body and text attachments in
`CESR-ATTACHMENT`. Multiple prepared messages yield ordered POST requests.

Keep the CESR parser's supported nested/binary framing rules; do not copy Python's
legacy scan-for-`{` segmentation. Preserve the existing rule that a later invalid
message does not retroactively prevent an earlier valid message being sent.

Retain current media compatibility at this boundary: current
`application/cesr`, with the existing narrow content-type-refusal fallback to
`application/cesr+json` for legacy peers. Preserve the exact signed body across
fallback, close the refused response first, and never retry arbitrary 4xx/5xx,
network failures, or successful requests. This is media compatibility, not
automatic retries or protocol-version negotiation.

### Stream HTTP

Add a concrete `HTTPStreamMessenger`. It issues exactly one PUT for a prepared
finite payload, using `application/cesr`, the destination header, and the actual
byte length. There is no attachment header, per-frame POST loop, parser,
decode/re-encode, inferred version change, or automatic fallback to ordinary POST.

The payload may contain an introduction, several forwarded messages, credentials,
proofs, or a complete supported ESSR envelope. The messenger treats it as opaque
bytes. Message preparation and sealing remain producer responsibilities.
Use the existing finite HTTP request client; do not reintroduce asynchronous
upload protocols, payload archives, application memory budgets, or custom ESSR
content streaming.

Python sends to `/` on its selected host. Use `/` for those peers, while preserving
the full explicitly resolved URL path supported by current keri-ts. Existing
tests use distinct paths such as `/good` to distinguish destinations. Discarding
a configured path is an unrelated API change, not necessary framing parity.
Keep specialized endpoints separate from the generic messenger contract.

### TCP

Use concrete ordinary and stream messenger construction with shared socket
operations. A thin `TCPStreamMessenger` can bind one finite payload and invoke
the existing raw writer; it must not duplicate connection, drain, or receive code.

Both variants transmit exactly the admitted bytes in order, independent of network
chunk boundaries. `streamCesrTcp` already writes the supplied source without
parsing it. Retain that behavior. The frame-specific helper remains distinct.

Ensure stream construction really admits its payload: this is the regression
that the pinned main and 1.3 Python factories miss. Do not add another queue just
to reproduce Python's queue admission mechanism.

Transmit-only completion remains local output drain followed by owned cleanup.
Do not wait for arbitrary remote EOF. Existing query/receipt duplex operations
retain concurrent RX/TX, their input-owned parser/Kevery, and the actual deadline
and acceptance predicates. Do not replace verified witness receipts with “sent.”

### Response and lifetime ownership

KERIpy ordinary HTTP captures responses; its stream messenger captures `rep`.
Neither makes a generic HTTP success equivalent to semantic acceptance.

Reuse the existing `HttpClient` contracts:

- Finite request operations return status, headers, and owned response bytes
  after closing the request scope.
- Scoped responses remain borrowed until their consumer finishes in that scope.
  Do not return a closed `HttpStreamResponse` or a hidden callback.
- Ordinary send-only delivery may continue to drain successful bodies and
  return its small delivery outcome. Where stream callers need response data,
  return the existing owned `HttpResponse`; do not invent a persistent response
  queue or response-history store.
- Keep an explicit adaptation from completed HTTP refusal to Poster's existing
  failed-target outcome. Network, source, parser, storage, and real cleanup
  failures retain their current distinctions and original causes.
- Query/SSE response parsing belongs to the query or polling operation. Extract
  the current query operation from `HTTPMessenger` if necessary so send-only
  construction needs no `ProtocolProcessor`, Habery, parser, or clock solely
  for an unused query method.

Do not broaden this into another shutdown-error redesign. Reuse the main task's
accepted close contract and existing real cleanup tests. Do not preserve
`ProtocolProcessor` just for messenger factories; follow whichever explicit
protocol dependencies survive the main task's separate assessment.

## Caller migration map

Python parity is selected by the operation's purpose, not by bytes, EXN route
strings inspected inside transport, identity settings, or the word “stream” in
a helper name.

| keri-ts owner / symbols                                                                                    | Required disposition                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/forwarding.ts`: `Poster.deliverEvent`, route/target records                                           | Ordinary admissions construct ordinary messengers; stream admissions construct stream messengers after preparation. Delete body-mode fields.                                                                                                       |
| Same: `findBytesRoutes`, `prepareBytesTarget`, `prepareForwardedTarget`                                    | Preserve ordinary multi-role routing, stream first-present-role routing, provider selection, introductions, per-message `/fwd` construction, and local mailbox storage. Send the final prepared stream in one PUT per selected remote HTTP target. |
| `app/cli/ipex.ts`: initial grant/admit/spurn                                                               | Retain their explicit stream admission and ordered support messages; verify single and group initiators actually reach stream transport.                                                                                                           |
| `app/ipex-grouping.ts`: `sendCredentialStream`, `groupIpexProposals`                                       | Keep preparation separate from admission. Initial commands select stream delivery explicitly for each peer.                                                                                                                                        |
| Same: `publishGroupIpexProposal`, `sendCompletedGroupIpex`, `sendCredentialBytes`; CLI join                | Retain ordinary completion behavior matching Python `ipex/join.py`. Do not globally switch all IPEX or all credential helpers to PUT.                                                                                                              |
| CLI apply/offer/agree, credential revocation, delegation, multisig workflows, endpoint replies, Respondant | Retain existing ordinary publication unless a concrete donor call site justifies changing that particular operation. No speculative conversion based on topic or content size.                                                                     |
| `app/querying.ts`: `QueryDelivery`, `prepareRequest`, `postQueryMessage`                                   | Remove captured mode. Construct ordinary delivery explicitly; retain query-owned CESR/SSE response processing and TCP reply intake.                                                                                                                |
| `app/witnessing.ts`: ordinary publication and query helpers                                                | Use ordinary construction; preserve authorization, receipt verification, witness fanout, and deadlines.                                                                                                                                            |
| Same: `/receipts` API                                                                                      | Keep its specialized signed POST/GET behavior. A dedicated HTTP endpoint is not automatically a generic stream messenger.                                                                                                                          |
| `app/forwarding.ts`: `MailboxPoller`, `fetchMailboxMessages`, `fetchMailboxQueryResponse`                  | Fixed signed-query POST and request-owned SSE intake, corresponding to Python Poller/createCESRRequest. Delete mode parameters.                                                                                                                    |
| `packages/tufa/src/operator/mailbox-debug.ts`                                                              | Same ordinary signed query; retain its bounded SSE diagnostic behavior.                                                                                                                                                                            |
| `packages/tufa/src/cli/mailbox.ts`: `postMailboxAdminCesr`                                                 | Preserve the dedicated raw-body admin POST and multipart contracts. Its use of a finite CESR-body helper does not make it `HTTPStreamMessenger`.                                                                                                   |
| Tufa generic CESR ingress / witness endpoints                                                              | Verify existing POST and PUT support with real peers. Preserve inbound supported media/framing and hosted-AID routing; outbound simplification does not authorize narrowing ingress.                                                               |

Keep one Poster FIFO queue and one worker. Stream admissions already carry
concrete intent; translating that intent into a messenger is sufficient.
Preserve per-admission wait/outcome correlation, partial successes, later-target
progress after expected failure, and no-I/O local-provider delivery.

## Remove the entire preference surface

Delete rather than deprecate:

- `pinGbls("cesrBodyMode", ...)` in `app/cli/init.ts` and common setup/ensure paths.
- Reads and normalization in `app/cli/common/existing.ts`; no migration reader.
- `Habery.cesrBodyMode`, constructor/create options, and default plumbing in
  `app/habbing.ts` and `app/cli/common/context.ts`.
- `CesrBodyMode`, `DEFAULT_CESR_BODY_MODE`, `normalizeCesrBodyMode`,
  `cesrBodyModeFromGlobal`, and framing-switch options in `app/cesr-http.ts`.
- `EgressOptions.bodyMode`, frame-request branching, route/target mode fields,
  and `QueryDelivery.bodyMode`.
- All CLI flags, help, argument parsing, and forwarding in KERI CLI
  init/challenge/exchange/OOBI/common code and Tufa agent/DWS/mailbox code.
- Tufa command definitions in lifecycle, mailbox, challenge, endpoints, and
  messaging; operator diagnostic overrides.
- Public mode/helper exports in `packages/keri/src/runtime/index.ts` and any
  newly discovered export surface, examples, scripts, or supported documentation.
- Tests whose contract is persistence, reopening, defaulting, or overriding that
  preference. Replace them with construction/wire-contract tests.

Do not replace it with `transportMode`, an environment variable, a Configer entry,
a persisted endpoint flag, or a generic messenger policy.
Do not automatically delete rows from existing user stores. An obsolete row can
remain inert because no production code reads it. No old-keri-ts compatibility
tests, migrations, or fallback aliases are required.

`buildCesrRequest` becomes unambiguously signed-message framing.
`buildCesrStreamRequest` may remain a finite raw-body builder used by both the
PUT messenger and dedicated admin POSTs; HTTP method belongs to the caller.
Clarify that name/docstring if needed. Preserve inbound helpers, supported media
constants, destination/attachment constants, and legitimate body-byte variables.

## Human-review PR sequence

Keep one implementation PR active. Respect the ten constraints' rule to refactor
responsibilities before changing behavior. Do not combine this work with unrelated
protocol, persistence, release, or package-layout changes.

### PR 1 — Separate transport construction and query response ownership

Review question: can each existing operation identify its actual transport and
receive dependencies without reading identity configuration?

- Establish small concrete construction contracts and ordinary `messengerFrom`.
  Move the HTTP query-only receive operation to its cohesive owner.
- Preserve current ordinary request behavior, parser semantics, media fallback,
  endpoint precedence, full endpoint paths, response scopes, and cleanup.
- Introduce the stream class/factory boundary using the existing finite HTTP
  client and shared TCP writer. Implement its PUT/raw-TCP contract with focused
  tests before routing production stream admissions through it.
- Keep any not-yet-migrated old preference plumbing only until PR 2. Do not
  publish compatibility facades or temporary replacement APIs. New constructors
  themselves must have no framing-mode option.
- Prefer two reviewable commits: responsibility extraction first, new concrete
  stream operation second. Do not preserve an ambiguous `.stream()` name that
  still means “split and POST”; rename or privatize that source-iteration helper.

Validation: ordinary framing/auth/media-refusal tests; new one-PUT exact-byte
test; real TCP factory transmission test; targeted query/SSE and response-lifetime
regressions. No broad release battery here.

### PR 2 — Wire explicit delivery intent and delete the persisted preference

Review question: does every production caller select the right operation, and is
the global preference absent end to end?

- Route Poster ordinary/stream admissions through the respective factories.
  Do not alter recipient-role semantics or add another worker.
- Apply the caller table, including initial-versus-join IPEX distinctions,
  fixed query/polling requests, and dedicated mailbox-admin exceptions.
- Delete the complete preference surface atomically, including CLI help, public
  exports, tests, and lower-layer options. Remove obsolete branches/imports
  exposed by that deletion.
- Update affected Poster tests to assert request count/method and all decoded
  messages. Existing tests that read only `parseBytes(...)[0]` would conceal
  lost later messages after combining several POSTs into one PUT.
- Include the relevant package changeset and a short breaking-change note:
  the CLI/config option and Habery setting are gone; library callers construct
  ordinary or stream messengers explicitly. Record that stream HTTP delivery
  now uses PUT and requires the peer's corresponding endpoint support.

Validation: affected KERI/Tufa CLI tests, Poster routing/queue tests, query and
mailbox tests, witness transport tests, and initial/group/join IPEX publication
tests. Include one real composed Python/Tufa stream exchange before merge.
Do not defer discovery of unsupported PUT endpoints until final qualification.

### PR 3 — Complete bounded interoperability and installed-package evidence

Review question: do the advertised transports work with the actual supported
Python implementations, not just request mocks or direct parser calls?

- Extend existing fixtures/owners to cover the matrix below. Avoid a parallel
  harness. Assign new tests in `scripts/ci/keri-test-suites.ts`.
- Fix transport integration gaps here only if they remain within this plan;
  carry substantive behavior fixes with their focused regressions.
- Verify Deno source and the freshly packed Node CLI/library artifacts.
- Record only compact source/import/artifact identities, tested cases, failures,
  and limitations. Preserve separate upstream and mailbox-fork attribution.

If all required tests fit naturally in PRs 1–2, do not manufacture an empty third
PR. Run this qualification step after those merges and attach its evidence to
the owning work. Use scoped CI according to `docs/reference/PR_TEST_SCOPE.md`;
the main task still owns final whole-release qualification.

## Bounded validation matrix

### Contract and lifecycle tests

1. Ordinary HTTP: two signed messages produce two ordered POSTs with the original
   signed bodies, correct attachment/destination/auth headers, and usable response
   completion. Retain existing nested-attachment tests.
2. Stream HTTP: a prepared introduction plus two messages produces one PUT with
   byte-for-byte identical payload, exact length, and no attachment header.
   Include one supported binary/count-enclosed or ESSR payload so accidental
   parsing/text conversion is observable.
3. Factory selection: HTTPS, HTTP-only, TCP-only, and missing endpoints; supplied
   path/destination/auth survive. Use a compact table, not separate frameworks.
4. TCP stream: construct through the real stream factory and read the complete
   admitted payload on a local listener. Assert no loss/duplication and completion
   without requiring the receiver to close first. Retain existing duplex tests.
5. Limited failures: ordinary legacy-media refusal closes before fallback; stream
   refusal or cancellation creates no POST fallback and joins the request; a late
   body/socket error cannot become a successful delivery. Reuse existing tests.
6. Poster: ordinary multi-role delivery, stream first-present-role delivery,
   ordered forwarded contents, local-provider bypass, partial failure, and
   concrete-admission outcome matching. Retain established witness/group topology.
   Validate retained CLI behavior through its existing command and package probes.
   Do not retain tests or lint blacklists solely to prove deleted APIs/options remain absent.

### Actual Python peers

Use real Python messenger factories and the normal Python HttpEnd/parser/semantic
owners. A control endpoint can select a scenario or inspect accepted state, but
must not impersonate the messenger or insert records to make delivery appear
successful. Existing `ipex_peer.py` mounts normal HttpEnd; the mailbox fixture
already constructs real StreamPoster. Extend those seams where appropriate.

| Scenario                                                                                     | Profiles                                                                 | Evidence                                                                                                                        |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| keri-ts ordinary POST into Python; Python ordinary messenger into Tufa                       | main, GLEIF 1.2.17, 1.3.6                                                | Signed KEL accepted/persisted; method/header assertions; legacy media path genuinely exercised                                  |
| keri-ts stream PUT into Python; Python stream messenger into Tufa                            | main, GLEIF 1.2.17, 1.3.6                                                | Multi-message stream accepted in order with expected identifiers/SAIDs; exact outbound bytes and method                         |
| Initial IPEX grant/admit with supporting artifacts and a group notification; join completion | main for native-v2; a compatible legacy workflow under 1.2 and 1.3       | Credential/evidence and EXNs accepted, correct initial PUT versus join POST, correct recipients and no missing support messages |
| Forwarded stream plus ordinary mailbox query/SSE retrieval                                   | maintained composed mailbox environment, labeled by actual fork pin      | Provider storage contains all intended messages; recipient processes them; poll remains signed POST                             |
| TCP stream send into real Python intake                                                      | at least GLEIF 1.2.17; retain existing main TCP coverage where available | Admitted bytes arrive and valid messages enter accepted state; no HTTP route masks TCP selection                                |

Parameterize the small transport probes across three profiles. Do not multiply
every IPEX verb, role, failure, and framing combination across every profile.
Use existing native-v2 and legacy credential workflow coverage, adding wire
assertions at the relevant boundary. Unsupported native-v2 features on v1 peers
are not test failures to hide with casts or monkeypatches.

The pinned main/1.3 TCP stream-factory defect limits claims about Python-originated
TCP stream delivery on those exact pins. Document it; do not silently patch the
reference and call it upstream qualification. Test keri-ts TCP construction
directly and use the fixed 1.2.14 factory for a Python-originated test if needed.
HTTP stream-factory tests must still run unmodified on all three pins.

For installed artifacts, use the existing package/CLI harness to prove exported
factories and both wire contracts under Node, plus CLI flag removal. Run supported
Node runtime checks already owned by package CI. No new packaging system is needed.
Use the main task's isolated Docker setup and named LMDB volumes if host execution
is unhealthy; do not change shared state or weaken test topology to obtain green.

## Completion and release integration

Before declaring this work complete:

- Re-inventory current callers and search production source/CLI definitions for
  `cesrBodyMode`, `CesrBodyMode`, `cesr-body-mode`, mode normalizers/defaults, and
  the old `bodyMode` transport option. There must be no preference reads/writes,
  exported aliases, hidden defaults, or selection branches.
- Confirm source-based factory selection reaches both real HTTP operations and
  TCP payload admission. Test names or a mocked 204 alone are insufficient.
- Verify parser/accepted-state assertions in the interop matrix and record actual
  reference imports. No claimed compatibility based only on installed versions.
- Run appropriate static checks, scoped tests, package checks, and
  `changeset:check` for each implementation PR. Run `git diff --check`.
- Put the removal and construction-based replacement in the prominent 2.0.0
  breaking-changes list and the main task's migration/change document. Keep
  other documentation edits to necessary contracts and short maintainer comments.
- Carry the final messenger contracts through the planned package reorganization
  and rerun affected tests after moves. Then include the finished change in final
  release qualification for `cesr-ts`, `keri-ts`, and `@keri-ts/tufa`.
- Preserve the main task's later `ProtocolProcessor` assessment. This refactor
  must neither require its retention nor secretly expand its responsibilities.

The residual design boundary is intentional: transport completion is not protocol
acceptance, and neither is a durable delivery acknowledgement. Retries, durable
outboxes, generic providers, broad Python porting, and delivery acknowledgements
remain outside this work.
