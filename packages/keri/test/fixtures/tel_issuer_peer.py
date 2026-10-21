"""Produce accepted legacy NoBackers TEL evidence with unmodified pinned Python APIs.

The credential identifier is opaque to TEL processing. This driver proves TEL
issuance/revocation and replay, not an ACDC wallet or KLI credential workflow.
"""
import argparse
import json
from keri.app.habbing import openHby
from keri.core.coring import Diger, Saider, Seqner
from keri.core.serdering import SerderKERI
from keri.vdr.eventing import Tevery, incept, issue, revoke

args = argparse.ArgumentParser()
args.add_argument("--legacy", action="store_true")
args = args.parse_args()
if args.legacy:
    from keri.vdr.viring import openReger
    versions, wire = {}, {}
else:
    from keri import Vrsn_1_0
    from keri.vdr.eventing import openReger
    versions, wire = dict(version=Vrsn_1_0), dict(gvrsn=Vrsn_1_0)

with openHby(name="tel-issuer", temp=True, **versions) as hby:
    with openReger(name="tel-issuer", temp=True) as reger:
        issuer = hby.makeHab("issuer")
        tvy = Tevery(db=hby.db, reger=reger, lax=True, local=False)
        registry = incept(issuer.pre, cnfg=["NB"], **versions)
        credential = Diger(ser=b"opaque credential commitment for TEL interoperability").qb64
        issuance = issue(credential, registry.pre, **versions)
        revocation = revoke(credential, registry.pre, issuance.said, **versions)
        events = []
        for event in (registry, issuance, revocation):
            anchor = SerderKERI(raw=issuer.interact(data=[dict(i=event.pre, s=event.snh, d=event.said)]))
            tvy.processEvent(serder=event, seqner=Seqner(sn=anchor.sn), saider=Saider(qb64=anchor.said))
            if event.ilk != "vcp":
                assert tvy.tevers[registry.pre].vcState(credential).et == event.ilk
            events.append(bytes(reger.cloneTvt(event.pre.encode(), event.said.encode(), **wire)).decode())
        print(json.dumps(dict(issuer=issuer.pre, registry=registry.pre, credential=credential,
                              revocation=revocation.said, events=events,
                              kel=b"".join(hby.db.clonePreIter(pre=issuer.pre, **wire)).decode())))
