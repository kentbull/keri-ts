# Pinned-main legacy registry approval mixes child attachment genera

Observed against unmodified WebOfTrust/keripy
`c7e74adc3129ba36302db32e58056560b0927424`, Python 3.14.6 / hio 0.7.20.
This is an upstream CLI limitation, **not passing registry-lifecycle evidence**.
No upstream changes have been submitted or applied to qualification peers.

## Finding

A Tufa member and Python member complete witnessed 2-of-2 group inception.
Tufa then runs `vc registry incept --alias group --registry-name registry` while
Python runs `multisig join --version 1.0 --group group --auto`, with `registry`
supplied to the normal registry-name prompt.

The returned Python `/multisig/vcp` EXN has a v1 body, v1 outer signature/pathed
counters and an `e.anc` proof beginning `-KAW` (v2 ControllerIdxSigs, 22 quadlets).
There is no child genus selector or v2 enclosure establishing that context.
In v1, `-K` means SadPathSigGroup. Tufa rejects the incompatible child with
`UnknownCodeError: Expected pather-compatible code, got B`; it must not guess a
different counter table to accept malformed evidence.

The source boundary is
[JoinDoer.vcp](https://github.com/WebOfTrust/keripy/blob/c7e74adc3129ba36302db32e58056560b0927424/src/keri/cli/commands/multisig/join.py#L695):
`messagize(serder=aserder, sigers=sigers, framed=True)` omits `gvrsn`, whose
library default is v2. `multisigRegistryInceptExn(..., version=Vrsn_1_0)` later
places those attachments into a legacy pathed wrapper without transcoding them.
The issuance handler contains the same omission; its end-to-end consequence has
not been qualified here. Do not generalize this result to every group handler.

## Small independent reproducer

Run this with the pinned checkout's interpreter. It uses public KERIpy factories,
a real GroupHab and its actual signer; no stored acceptance rows are fabricated.
The single-member group is sufficient to isolate framing; the observed network
failure above used two independent member stores and a witness.

```python
from keri import Vrsn_1_0
from keri.app.habbing import openHby
from keri.app.grouping import multisigRegistryInceptExn
from keri.core import Parser, SerderKERI, messagize
from keri.vdr.eventing import incept

with openHby(name="vcp-genus", temp=True, version=Vrsn_1_0) as hby:
    member = hby.makeHab("member")
    group = hby.makeGroupHab(group="group", mhab=member,
                            smids=[member.pre], isith="1", nsith="1",
                            version=Vrsn_1_0)
    vcp = incept(group.pre, cnfg=["NB"], version=Vrsn_1_0)
    anchor = SerderKERI(raw=group.interact(
        data=[dict(i=vcp.pre, s="0", d=vcp.said)],
        version=Vrsn_1_0, gvrsn=Vrsn_1_0))
    for explicit in (False, True):
        anc = messagize(serder=anchor, sigers=group.sign(anchor.raw),
                        framed=True,
                        **(dict(gvrsn=Vrsn_1_0) if explicit else {}))
        exn, atc = multisigRegistryInceptExn(
            group, usage="reproducer", vcp=vcp.raw, anc=anc,
            version=Vrsn_1_0)
        children = Parser(version=Vrsn_1_0).parse(
            ims=bytearray(anc), framed=True, processive=False)
        print(explicit, bytes(anc[anchor.size:anchor.size + 4]),
              None if children is None else len(children))
```

Observed output: default `False b'-KAW' None`; explicit v1 `True b'-AAB' 1`.
The outer wrapper itself decodes in both cases; that does not validate the child.
This reproducer demonstrates a candidate correction, not a patched-peer pass.

## Recommendation and qualification boundary

Keep a legacy pathed child's proofs in the enclosing v1 attachment context, or
use a protocol-valid explicit enclosure/selector when carrying another genus.
Audit the VCP/ISS/REV child-signing sites for this precise boundary rather than
changing every serializer's default. Add a focused child decode regression.

The maintained mixed-group CLI test separately proves reciprocal inception and
interaction approval. Credential lifecycle tests must use validly framed public
protocol/API evidence where this CLI is blocked and label that distinction. The
main CLI registry-approval gate remains blocked at this pin; do not claim full
Python CLI credential parity from TypeScript-only or corrected-API tests.

## Protected local approval is a separate CLI boundary

The GLEIF 1.2.17 pin `b8626e1d58770a4a480ea72a01acc5580278a9f2`
reaches `Waiting for TEL registry vcp event mulisig anchoring event` in the same
witnessed VCP join scenario and does not complete before the 90-second diagnostic
deadline. This is not passing legacy registry CLI evidence either.

Its [join handler](https://github.com/GLEIF-IT/keripy/blob/b8626e1d58770a4a480ea72a01acc5580278a9f2/src/keri/app/cli/commands/multisig/join.py#L645)
signs the approved anchor and calls `self.psr.parseOne(...)` without protected
local intake. `Parser.local` defaults to false. Kever deliberately filters the
locally contributed group signature on remote input; this is a security boundary,
not a reason to relax the validator. Main's corresponding VCP signing site has
the same source-selection omission as well as the framing problem above.

An isolated check using actual group keys reproduces the local-source distinction
on **all three pins**. For legacy pins omit the two version/framing keyword sets:

```python
from keri import kering
from keri.app.habbing import openHby
from keri.core import eventing, parsing

versions = dict(version=kering.Vrsn_1_0)  # {} on the legacy pins
framing = dict(gvrsn=kering.Vrsn_1_0, framed=True)  # {} on legacy
with openHby(name="local-approval", temp=True, **versions) as hby:
    member = hby.makeHab("member")
    group = hby.makeGroupHab(group="group", mhab=member,
                            smids=[member.pre], isith="1", nsith="1", **versions)
    anchor = eventing.interact(group.pre, group.kever.serder.said,
        sn=1, data=[], kind=kering.Kinds.json, **versions)
    signed = eventing.messagize(anchor, sigers=group.sign(anchor.raw), **framing)
    parser = parsing.Parser(kvy=hby.kvy, **versions)
    parser.parseOne(ims=bytearray(signed))
    print(parser.local, group.kever.sn)  # False, 0
    parser.parseOne(ims=bytearray(signed), local=True)
    print(group.kever.sn)  # 1
```

Only an explicit application approval may select protected local processing;
untrusted network arrival must not gain it automatically. The maintained mixed
credential API fixture follows this distinction and uses ordinary escrows.
The isolated 1.3 result establishes the source-policy behavior, not an unexecuted
1.3 CLI timeout. Upstream should review the credential join approval sites along
with their local Multiplexor registration, then qualify the full witnessed CLI
path. No patched CLI success is claimed here.

## Independent-holder main CLI audit

The existing independent KLI holder/Tufa issuer/Tufa verifier/mailbox-provider
workflow was also attempted against the same main pin, adapting only CLI argument
selection to its actual help. Current `vc`, `ipex` and `mailbox` commands do not
accept the older fork's `--version 1.0` option. The topology and ordinary CLI
operations were preserved; no peer source or accepted database rows were changed.

With a root provider URL, `mailbox add` fails before transmission:
`Already open connection attempt to change hostname ... to 'mailboxes'`.
Its [request path](https://github.com/WebOfTrust/keripy/blob/c7e74adc3129ba36302db32e58056560b0927424/src/keri/cli/commands/mailbox/add.py#L113)
appends `/mailboxes` to requester path `/`, producing `//mailboxes`. Hio treats
that as a network-path reference to a different host. Normalize the path join;
this is separate from protocol authentication.

A valid Tufa identity-scoped provider URL gets past that failure. Authorization
then receives HTTP 400, `Invalid mailbox authorization reply: Unknown matter hard selector -`. Main's `Hab.replay()` and `Hab.reply()` default to attachment genus
v2 even for established v1 bodies; `reply()` defaults `genusify=False`. The CLI
passes neither an explicit legacy genus nor an explicit selector to these calls,
and the multipart mailbox boundary does not select that alternate context. The
same evidence may be valid in an explicitly selected v2 context; this observation
does not justify guessing alternate counter tables or weakening authorization.
The intended default context at this cross-implementation multipart boundary
merits upstream agreement. This main CLI wallet lane remains **unqualified**.

The mixed credential scenario separately uses a fresh Python Habery/Reger and
private identity as recipient. A group-issued credential reaches that wallet via
actual HTTP support and grant messages, then public Parser/Verifier operations
reconstruct the grant's authenticated children before an actual admission is
sent. Later real revocation replay reaches the same independent store. Explicit
legacy framing and Serder factories are public API choices, not patched CLI
success. The separate maintained mailbox-fork CLI workflow remains required.
