"""Live native registry builders and read-only vetting against independently parsed KELs.

The proof controls parse foreign KELs and call the candidate's read-only native
proof APIs. The POSIX custody control also uses its actual wallet/registry owners
to export a protected operator handoff.
"""
import argparse
import hashlib
import json
from pathlib import Path

from keri import Vrsn_2_0
from keri.acdc.messaging import acdcmap, blindate, regcept
from keri.acdc.regeventing import vet, vetBinds
from keri.app import openHby
from keri.core import Blinder, BlindState, BoundState, Codens, Counter, DigDex, Diger, Kevery, Parser, SerderACDC


def author():
    """Author fresh evidence using a Python issuer; return only public wire and a disclosure."""
    with openHby(name="native-author", temp=True, version=Vrsn_2_0) as hby:
        issuer = hby.makeHab(name="issuer", version=Vrsn_2_0)
        issuee = hby.makeHab(name="issuee", version=Vrsn_2_0)
        issuee.interact(gvrsn=Vrsn_2_0)
        rip = regcept(issuer.pre)
        issuer.interact(data=[dict(i=rip.said, s="0", d=rip.said)], gvrsn=Vrsn_2_0)
        credential = acdcmap(issuer.pre, regid=rip.said, attribute=dict(d="", i=issuee.pre, name="Ada"))
        opening = Blinder(crew=BoundState(d="", u=Blinder.makeUUID(sn=1),
                                         td=credential.said, ts="issued",
                                         bn=f"{issuee.kever.sn:x}", bd=issuee.kever.serder.said),
                          makify=True, saids={"d": DigDex.SHA2_256})
        material = b"#" * 44 + b"".join(value.qb64b for value in opening.data[1:])
        assert Diger(raw=hashlib.sha256(material).digest(),
                     code=DigDex.SHA2_256).qb64 == opening.said
        update = blindate(rip.said, rip.said, opening.said)
        public_update = bytes(update.raw) + bytes(Counter.enclose(qb64=Blinder.enclose([opening]),
                                                                code=Codens.AttachmentGroup, version=Vrsn_2_0))
        issuer.interact(data=[dict(i=rip.said, s="1", d=update.said)], gvrsn=Vrsn_2_0)
        opaque = Blinder.blind(acdc=credential.said, state="revoked", sn=2)
        later = blindate(rip.said, update.said, opaque.said, sn=2)
        issuer.interact(data=[dict(i=rip.said, s="2", d=later.said)], gvrsn=Vrsn_2_0)
        return dict(rip=rip.raw.decode(), update=update.raw.decode(),
                    publicUpdate=public_update.decode(),
                    laterUpdate=later.raw.decode(),
                    credential=credential.raw.decode(), opening=opening.crew._asdict(),
                    kel=b"".join(message for hab in (issuer, issuee)
                                 for message in hby.db.clonePreIter(pre=hab.pre, gvrsn=Vrsn_2_0)).decode())


def verify(evidence):
    """Verify the foreign KEL normally before invoking read-only native proof APIs."""
    with openHby(name="native-verifier", temp=True, version=Vrsn_2_0) as hby:
        rip, update, credential = [SerderACDC(raw=evidence[key].encode())
                                   for key in ("rip", "update", "credential")]
        kvy = Kevery(db=hby.db, lax=False, local=False)
        Parser(version=Vrsn_2_0, kvy=kvy).parse(ims=bytearray(evidence["kel"].encode()))
        assert hby.db.kevers[rip.issuer.qb64].sn == 2
        opening = Blinder(crew=BlindState(**evidence["opening"]), saidive=True)
        state = vet(rip, [update], db=hby.db, acdc=credential, blinder=opening)
        bound = vetBinds(rip, [update], db=hby.db, acdc=credential,
                        blinders=[opening], target=credential.said)
        assert state == bound
        assert state.regid == rip.said and state.said == update.said
        assert state.acdc == credential.said and state.state == "issued"
        assert state.binding == "mutual" and state.sn == 1
        return state._asdict()


def custody_handoff(request):
    """Export one protected operator file; return wire and selected test openings, never its salt."""
    import os
    if os.name != "posix":
        raise RuntimeError("protected custody handoff fixture requires POSIX")
    from keri.acdc import Regery, Registrar
    from keri.acdc.regbasing import RegBaser
    from keri.app.configing import Configer
    from keri.app.credentialing import Wallet, WalletBaser
    from keri.app.registry_custody import RegistryCustody
    from keri.core import Signer

    root = Path(request["root"])
    key = Signer(transferable=False)
    with openHby(name="custody-python", temp=False, headDirPath=str(root),
                 cf=Configer(name="custody-python", temp=True), seed=key.qb64,
                 aeid=key.verfer.qb64, version=Vrsn_2_0) as hby:
        issuer = hby.makeHab(name="issuer", version=Vrsn_2_0)
        Parser(version=Vrsn_2_0, kvy=Kevery(db=hby.db, lax=False, local=False)).parse(
            ims=bytearray(request["kel"].encode()))
        issuee = hby.db.kevers[request["discloser"]]
        rgy = Regery(hby, baser=RegBaser(name=hby.name, headDirPath=str(root), temp=False))
        wallet = Wallet(hby, rgy, db=WalletBaser(name=hby.name, headDirPath=str(root), temp=False))
        custody = RegistryCustody(hby, rgy, db=wallet.db)
        try:
            registry = Registrar(rgy).makeRegistry(name="handoff", prefix=issuer.pre)
            rip = rgy.store.event(registry.regk)

            def accept(event):
                issuer.interact(data=[dict(i=registry.regk, s=event.sad["n"], d=event.said)], gvrsn=Vrsn_2_0)
                assert registry.anchorMsg(event.said)

            accept(rip)
            info = custody.createCustody(registry.regk, request["discloser"])
            credential = acdcmap(issuer.pre, regid=registry.regk,
                                attribute=dict(d="", i=request["discloser"], role="custody-holder"))
            proofs, updates = [], []
            prior = rip.said
            for sn, state in [(1, "issued"), (2, "revoked")]:
                proof = custody.derive(registry.regk, sn, credential.said, state,
                                       bound=True, bsn=issuee.sn, bd=issuee.serder.said)
                update = blindate(registry.regk, prior, proof.said, sn=sn)
                wallet.retainDerivedUpdate(update, proof)  # F02 ordering: before processing/anchor.
                registry.processEvent(update)
                accept(update)
                proofs.append(proof)
                updates.append(update)
                prior = update.said
            public = Blinder.blind(acdc="", state="")
            successor = blindate(registry.regk, prior, public.said, sn=3)
            registry.processEvent(successor)
            accept(successor)
            wallet.retainPublicOpening(successor, public)
            custody.exportCustody(registry.regk, request["handoff"])
            published = bytes(successor.raw) + bytes(Counter.enclose(
                qb64=Blinder.enclose([public]), code=Codens.AttachmentGroup, version=Vrsn_2_0))
            return dict(registry=registry.regk, controller=issuer.pre, discloser=request["discloser"],
                        rip=rip.raw.decode(), credential=credential.raw.decode(),
                        updates=[update.raw.decode() for update in updates], publicUpdate=published.decode(),
                        opening=proofs[0].crew._asdict(),
                        future=custody.derive(registry.regk, 17, credential.said, "revoked").qb64,
                        kel=b"".join(hby.db.clonePreIter(pre=issuer.pre, gvrsn=Vrsn_2_0)).decode())
        finally:
            wallet.close()
            rgy.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("author", "verify", "custody"))
    parser.add_argument("evidence", nargs="?")
    args = parser.parse_args()
    evidence = json.loads(Path(args.evidence).read_text()) if args.evidence else None
    result = author() if args.mode == "author" else (custody_handoff(evidence) if args.mode == "custody" else verify(evidence))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
