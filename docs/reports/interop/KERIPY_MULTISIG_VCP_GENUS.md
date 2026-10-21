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
