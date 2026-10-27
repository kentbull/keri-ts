"""Live native registry builders and read-only vetting against independently parsed KELs.

The proof controls parse foreign KELs and call the candidate's read-only native
proof APIs. The POSIX custody control also uses its actual wallet/registry owners
to exchange protected operator handoffs and reopen the receiving stores.
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
    if request.get("receive"):
        return custody_receive(request)
    import os
    if os.name != "posix":
        raise RuntimeError("protected custody handoff fixture requires POSIX")
    from keri.acdc import Regery, Registrar
    from keri.acdc.regbasing import RegBaser
    from keri.app.configing import Configer
    from keri.app.credentialing import Wallet, WalletBaser
    from keri.app.registry_custody import RegistryCustody

    root = Path(request["root"])
    with openHby(name="custody-python", temp=False, headDirPath=str(root),
                 cf=Configer(name="custody-python", temp=True), bran="PythonCustodyFixtureSecret",
                 version=Vrsn_2_0) as hby:
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


def custody_receive(request):
    """Import TS custody through its protected API, then derive again in a fresh process."""
    from dataclasses import asdict
    from keri.acdc import Regery
    from keri.acdc.regbasing import RegBaser
    from keri.acdc.regeventing import Rever
    from keri.app.configing import Configer
    from keri.app.credentialing import Wallet, WalletBaser
    from keri.app.evidencing import EvidenceProcessor
    from keri.app.registry_custody import RegistryCustody
    from keri.kering import ConfigurationError, ValidationError

    root = Path(request["root"])
    with openHby(name="custody-python", temp=False, headDirPath=str(root),
                 cf=Configer(name="custody-python", temp=True), bran="PythonCustodyFixtureSecret",
                 version=Vrsn_2_0) as hby:
        rgy = Regery(hby, baser=RegBaser(name=hby.name, headDirPath=str(root), temp=False))
        wallet = Wallet(hby, rgy, db=WalletBaser(name=hby.name, headDirPath=str(root), temp=False))
        custody = RegistryCustody(hby, rgy, db=wallet.db)
        try:
            info = request["info"]
            credential = SerderACDC(raw=request["credential"].encode())
            if request["receive"] == "import":
                processor = EvidenceProcessor(hby, kvy=Kevery(db=hby.db, lax=False, local=False),
                                              rever=Rever(db=hby.db, reger=rgy.baser))
                result = processor.ingest((request["kel"] + request["tel"]).encode())
                assert not result["pending"] and not result["rejected"], result
                try:
                    custody.derive(info["registry"], 1, credential.said, "issued")
                except ConfigurationError:
                    pass
                else:
                    raise AssertionError("reverse receiver unexpectedly had custody before import")
                try:
                    custody.importCustody(request["handoff"], regid=info["registry"],
                                          controller=info["discloser"], discloser=info["discloser"])
                except ValidationError:
                    pass
                else:
                    raise AssertionError("reverse import accepted a wrong controller")
                imported = custody.importCustody(request["handoff"], regid=info["registry"],
                                                controller=info["controller"], discloser=info["discloser"])
                assert asdict(imported) == info
            else:
                assert request["receive"] == "reopen"
            rip = rgy.store.seqEvent(info["registry"], 0)
            update = rgy.store.seqEvent(info["registry"], 1)
            assert rip is not None and update is not None
            assert update.said == request["update"] and rgy.store.head(info["registry"]).qb64 == update.said
            proof = custody.derive(info["registry"], 1, credential.said, "issued",
                                   bound=True, bsn=request["bsn"], bd=request["bd"])
            assert wallet.publicOpening(update) is None
            state = vet(rip, [update], db=hby.db, acdc=credential, blinder=proof)
            assert state.state == "issued" and state.said == update.said
            return dict(opening=proof.qb64,
                        future=custody.derive(info["registry"], 17, credential.said, "revoked").qb64,
                        update=update.said, state=state.state)
        finally:
            wallet.close()
            rgy.close()


def service(request, observer=False):
    """Serve the selected real Falcon/HIO app over TLS with ordinary bootstrap ingress."""
    import signal
    import falcon
    from hio.base import doing
    from hio.core import http
    from keri.acdc import Regery
    from keri.acdc.regbasing import RegBaser
    from keri.app.configing import Configer
    from keri.app.indirecting import createHttpServer
    from kfregistrar.core.serving import Context as RegistrarContext, DEFAULT_KRAM_CONFIG, loadExternalEnds
    from kfobserver.core.evidence import Context as ObserverContext
    from kfobserver.core.evidence_observing import ObservationBaser, RegistrarPuller

    root = Path(request["root"])
    cf = Configer(name="service", headDirPath=str(root), temp=False, reopen=True)
    with openHby(name="service", temp=False, headDirPath=str(root), cf=cf, version=Vrsn_2_0) as hby:
        hab = hby.makeHab(name="service", version=Vrsn_2_0)
        reger = RegBaser(name=hby.name, headDirPath=str(root), temp=False)
        if observer:
            import kfobserver.core.evidence as selected
            observations = ObservationBaser(name=hby.name, headDirPath=str(root), temp=False)
            source = dict(url=request["source"], cafilepath=request["certificate"], certedhost="localhost")
            ctx = ObserverContext(hby, reger=reger, observations=observations, sources=[source],
                                  readers=request["readers"], maximumAge=5, config=DEFAULT_KRAM_CONFIG)
            app = ctx.app
            workers = [RegistrarPuller(hab, ctx, ctx.sources, interval=.1, timeout=1)]
        else:
            import kfregistrar.core.serving as selected
            rgy = Regery(hby, baser=reger)
            ctx = RegistrarContext(hby, hab, rgy, observers=request["observers"],
                                   publishers=request["publishers"], fullEvidence=True,
                                   config=DEFAULT_KRAM_CONFIG)
            app = falcon.App()
            loadExternalEnds(app, ctx)
            workers = []
        server = None
        try:
            result = ctx.ingest(request["bootstrap"].encode())
            assert not result["rejected"] and not result["pending"], result
            server = createHttpServer(host="127.0.0.1", port=request["port"], app=app,
                                      keypath=request["certificate"], certpath=request["certificate"],
                                      cafilepath=request["certificate"])
            assert server.reopen()
            Path(request["ready"]).write_text(json.dumps(dict(
                pre=hab.pre, kel=b"".join(hby.db.clonePreIter(pre=hab.pre, gvrsn=Vrsn_2_0)).decode(),
                module=str(Path(selected.__file__).resolve()))))
            def stop(_signum, _frame):
                raise KeyboardInterrupt
            signal.signal(signal.SIGTERM, stop)
            try:
                doing.Doist(real=True, tock=.01).do(doers=[ctx, http.ServerDoer(server=server), *workers])
            except KeyboardInterrupt:
                pass
        finally:
            if server is not None:
                server.close()
            ctx.close()
            cf.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("author", "verify", "custody", "registrar", "observer"))
    parser.add_argument("evidence", nargs="?")
    args = parser.parse_args()
    evidence = json.loads(Path(args.evidence).read_text()) if args.evidence else None
    if args.mode in ("registrar", "observer"):
        service(evidence, observer=args.mode == "observer")
        return
    result = author() if args.mode == "author" else (custody_handoff(evidence) if args.mode == "custody" else verify(evidence))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
