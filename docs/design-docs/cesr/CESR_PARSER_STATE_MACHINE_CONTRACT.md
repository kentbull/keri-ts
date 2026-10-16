# CESR Parser State Machine Contract

[ADR-0012](../../adr/adr-0012-progressive-nested-parser.md) requires one finite
buffered decoder. `parser/decoder.ts` decodes finite byte ranges;
`parser/complete.ts` supplies synchronous `parseBytes(bytes)` and
`parser/parser.ts` receives fragments for async `parse(source)`.
Both use the same grammar. There is no progressive engine, cursor, parser staging,
alternate strategy or compatibility API.

## Completion boundaries

The receiving loop accumulates incomplete input. A counted enclosure must arrive
in full before its first child is decoded. This deliberately accepts memory and
first-child latency proportional to the complete group.

| Boundary                                    | Behavior                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| Partial input or empty chunk                | Request more source bytes; emit no unfinished message.                              |
| Counted GenericGroup                        | Receive the entire enclosure, then yield its complete children in order.            |
| BodyWithAttachmentGroup                     | Require exactly one complete parent tree and exhaust its enclosure before yielding. |
| Following body                              | Complete the preceding open attachment set.                                         |
| Complete attachment enclosure               | Complete its frame; later evidence cannot attach to it.                             |
| Real source EOF                             | Complete an open frame only if no partial attachment remains.                       |
| Inner shortage in a complete enclosure      | Reject with GroupSizeError; later bytes cannot repair it.                           |
| EOF before a declared extent                | Reject with ShortageError.                                                          |
| Malformed later sibling in a received group | Keep earlier delivered siblings; terminate once.                                    |
| Source failure or consumer return           | Join the source iterator's actual cleanup.                                          |

Network chunk boundaries and annotation separators never delimit messages.
Explicit framing must complete without waiting for connection EOF. Buffering a
group does not create a database transaction or rollback accepted siblings.
`parseBytes` returns the complete ordered array or throws; it has no asynchronous
I/O or disposal lifecycle. Each invocation starts with fresh genus selection.

## Evidence and versions

Bodies hydrate through Serder. Attachment wrappers flatten into semantic leaves;
`nests` holds parent-owned child records in wire order. Each child retains its
own body, proofs and resolved genus. Parsing never authenticates an event, and
parent signatures never authenticate descendants.

`CesrFrame.essrs` is an optional ordered `Texter[]`. Qualified codes, token
boundaries, multiplicity and raw bytes derive from that one representation.
Empty ESSR groups remain distinguishable from absence. Ordinary frames and
Texters require no disposal. Storage and crypto own their real file operations.

`gvrsn` selects counters and attachments independently of body protocol `pvrsn`.
Explicit root selectors persist between messages. Inner selectors remain local
to their enclosing scope; unselected inference does not select later roots.
Never retry malformed selected input under another major version.

V1 evidence counters count items; v2 counters count payload quadlets/triplets.
Sized wrappers count payload units in both genera. Selectors carry versions,
not lengths. All bounded groups must exhaust their declared extent.

## Failure and cancellation

Async `parse` wraps intrinsic wire failures in `WireParseError` with their precise
finite-decoder cause. Source failures and unexpected codec failures preserve
identity. The synchronous finite API throws the underlying error directly.
An I/O source abort failure retains its identity, including when it is a ParserError.
Distinct parsing and source-cleanup failures propagate together.

The parser and finite annotation APIs have no cancellation options. Consuming
operations check before and after pulls, before done/dispatch, and stop suspended
processing on external cancellation. Concrete transport owns the AbortSignal and
must interrupt its blocked I/O before joining it. Generator return cannot interrupt
arbitrary pending reads. The parser joins source return; it does not install
timers, pending-reader registries or a host scheduler.
The CESR root has no Effection dependency. The optional Effection frame adapter
remains transitional transport removal work; see the
[replacement plan](../../plans/cesr/CESR_PROGRESSIVE_PARSER_PLAN.md).

## Regression mapping

- `buffered.test.ts`: complete-enclosure delivery, truncation, source identity,
  source-abort cleanup and mixed native codecs.
- `nests.test.ts`: independent Python bodies/signatures, tree scope and invalid wrappers.
- `chunk-completion.test.ts`, `boundary-shortage.test.ts`, `eof.test.ts`:
  actual boundaries and terminal failures.
- `genus-context.test.ts`, `version-context.test.ts`, `wrapper-version.test.ts`:
  explicit selection, local restoration and legacy inference.
- `essr.test.ts`, `serialize-nests.test.ts`: order, duplicates, qualification,
  padding and both genera/domains.
- `external-fixtures.test.ts`, `external-corpus.test.ts`, `attachment-parity.test.ts`:
  independent reference facts.
- Tufa `progressive-ingress.test.ts`: complete HTTP group delivery, no acceptance
  from a truncated group, blocked-read cancellation and KRAM authorization.
