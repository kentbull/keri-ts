# Mailbox flow reference

Historical sequence illustrations from 2026-04-07. The current
[mailbox design](../../design-docs/mailbox/MAILBOX.md) and
[read authorization](../../design-docs/mailbox/READ_AUTHORIZATION.md) govern behavior.
These v1 pathed illustrations do not describe v2 nested evidence or current read
authentication; KERIpy standalone mailbox wiring refers to the mailbox fork.

## End-To-End Sequences

These diagrams are intentionally redundant with the prose above. They exist so
maintainers can rehydrate the mailbox model quickly without re-reading the whole
document.

### Sequence 1: Mailbox Add

```text
Recipient Controller C           Mailbox Provider M
----------------------           ------------------
choose mailbox provider M
build signed rpy:
  /end/role/add
  cid=C
  role=mailbox
  eid=M
build kel replay
        |
        | POST /mailboxes (raw application/cesr stream: kel, optional delkel, rpy)
        |-------------------------------------------->|
        |                                             | verify request targets hosted mailbox AID M
        |                                             | ingest CESR stream into normal KERI processing
        |                                             | accepted state now says:
        |                                             | ends[(C, mailbox, M)] = allowed
        |<--------------------------------------------|
        |                200 OK if accepted

Result:
  C has authorized mailbox provider M for itself.
```

### Sequence 2: Sender Delivers Through `/fwd`

```text
Sender S                         Mailbox Provider M                Mailbox Storage
--------                         ------------------                ---------------
resolve recipient C's
authorized mailbox endpoints
find mailbox M
build inner message
wrap inner message in /fwd:
  q.pre = C
  q.topic = /challenge (example)
  e.evt = inner message
        |
        | POST /fwd
        |-------------------------------------------->|
        |                                             | parse outer /fwd
        |                                             | identify recipient C from q.pre
        |                                             | identify topic from q.topic
        |                                             | reconstruct inner payload from e.evt + attachments
        |                                             | check accepted auth:
        |                                             | ends[(C, mailbox, M)] == allowed
        |                                             |---------------------------------> store under "C//challenge"
        |<--------------------------------------------|
        |                     204

Result:
  The mailbox stores the inner payload for recipient C.
  It does not store the outer /fwd wrapper as mailbox payload.
```

### Sequence 3: Recipient Polls With `mbx`

```text
Recipient Controller C           Mailbox Provider M                Mailbox Storage
----------------------           ------------------                ---------------
compute next wanted topic indices
from local tops. cursor state
build qry route=mbx
        |
        | POST qry(mbx)
        |-------------------------------------------->|
        |                                             | accept query
        |                                             | Kevery.processQuery("mbx")
        |                                             | emits stream cue
        |                                             | cue routing connects query to SSE responder
        |                                             |---------------------------------> read unread payloads under C/topic
        |<============================================|
        |        SSE stream of stored inner payloads
        |
ingest returned payloads normally
advance local tops. cursor state

Result:
  Retrieval is poll-driven.
  The mailbox host does not push traffic to C on its own.
```
