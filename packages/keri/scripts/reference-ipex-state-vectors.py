"""Accepted Grant registry observations and immutable views from pinned Python.

Run on the exact source archive with Docker-owned KEL/TEL state. All credentials
use ordinary constructors; no received-byte or exposed-section normalization.
"""
import hashlib
import json
import pathlib
import subprocess
import sys
from keri import Kinds, Vrsn_2_0
from keri.app import openHby
from types import SimpleNamespace
from keri.core import Diger, Noncer, Number, Parser, Pather, Salter, Texter, exchept, messagize
from keri.acdc import Regery, Registrar, acdcmap, ipexing
from keri.kering import ValidationError
from keri.peer import Exchanger
from keri.peer.exchanging import serializeParsedSubstream

REFERENCE = "2b19fa875d8c803c613087102db51b9e07124588"
root = pathlib.Path(ipexing.__file__).resolve().parents[3]


def verify_source():
    """Check every imported module against exact committed bytes, including lazy imports."""
    modules = {}
    for name, module in list(sys.modules.items()):
        if (name == "keri" or name.startswith("keri.")) and getattr(module, "__file__", None):
            path = pathlib.Path(module.__file__).resolve()
            if path.suffix == ".py":
                raw = path.read_bytes()
                assert raw == subprocess.check_output(["git", "-c", f"safe.directory={root}", "-C", str(root), "show", f"{REFERENCE}:{path.relative_to(root)}"]), str(path)
                modules[str(path.relative_to(root))] = hashlib.sha256(raw).hexdigest()
    return dict(sorted(modules.items()))


class RecordingExchanger(Exchanger):
    """Record the actual parser-driven attempt independently of durable acceptance."""
    latest = None

    def processEvent(self, *args, **kwa):
        try:
            self.latest = super().processEvent(*args, **kwa)
            return self.latest
        except ValidationError:
            self.latest = False
            raise


verify_source()
support, cases = [], []
stamp = "2026-10-13T01:00:00.000000+00:00"
salt = Salter(raw=b"0123456789abcdef").qb64
with (openHby(name="state-source", temp=True, salt=salt) as source,
      openHby(name="state-receiver", temp=True, salt=salt) as receiver):
    issuer, sender = source.makeHab(name="issuer"), source.makeHab(name="sender")
    recipient = receiver.makeHab(name="recipient")
    for hab in (issuer, sender, recipient):
        wire = bytes(hab.msgOwnEvent(sn=0, framed=False, gvrsn=Vrsn_2_0))
        support.append(dict(kind="kel", wire=wire.decode()))
        if hab is not recipient:
            Parser().parse(ims=bytearray(wire), kvy=receiver.kvy)
    sourceRgy = Regery(hby=source, name="state-source", temp=True)
    receiverRgy = Regery(hby=receiver, name="state-receiver", temp=True)
    registrar = Registrar(rgy=sourceRgy)
    exc = RecordingExchanger(hby=receiver, handlers=[])
    ipexing.loadHandlers(hby=receiver, exc=exc, notifier=None, rgy=receiverRgy)
    try:
        def publish(event):
            """Replicate public TEL bytes through the receiver's v2 owner."""
            support.append(dict(kind="tel", wire=event.raw.decode()))
            assert receiverRgy.processEvent(event)

        def anchor(registry, event):
            """Seal a real registry event in the issuer KEL before replication."""
            wire = issuer.interact(data=[dict(i=registry.regk, s=event.sad["n"], d=event.said)], framed=False, gvrsn=Vrsn_2_0)
            assert registry.anchorMsg(event.said)
            support.append(dict(kind="kel", wire=bytes(wire).decode()))
            Parser().parse(ims=bytearray(wire), kvy=receiver.kvy)

        def registry(name):
            reg = registrar.makeRegistry(name=name, prefix=issuer.pre, stamp=stamp,
                                         uuid=Noncer(raw=Diger(ser=("registry:" + name).encode()).raw).qb64)
            rip = sourceRgy.store.event(reg.regk)
            anchor(reg, rip)
            return reg, rip

        def signed(body):
            return messagize(serder=body, tsgs=[(issuer.kever.prefixer, Number(sn=issuer.kever.lastEst.s),
                             Diger(qb64=issuer.kever.lastEst.d), issuer.sign(ser=body.raw, indexed=True))],
                             framed=False, gvrsn=Vrsn_2_0)

        def proofed(body, *proofs):
            return messagize(serder=body, bonds=[proof.data for proof in proofs], framed=False, gvrsn=Vrsn_2_0)

        def grant(name, bodies, author=sender):
            paths = ["/", "/e/good/_/", "/e/other/_/"]
            return exchept(sender=author.pre, receiver=recipient.pre, route="/ipex/grant",
                           attributes=dict(m=name, o=[bodies[0].said]),
                           modifiers=dict(dp=[[[body.schema["$id"], paths[i], []] for i, body in enumerate(bodies)]]),
                           nonce=Noncer(raw=Diger(ser=name.encode()).raw[:16]).qb64, stamp=stamp, kind=Kinds.json, pvrsn=Vrsn_2_0, gvrsn=Vrsn_2_0)

        def node_verdict(nest):
            try:
                return exc.routes["/ipex/grant"].verifyIssuerAuthNode(nest.serder, nest).verdict
            except ValidationError:
                return "invalid"

        def receive(name, message, streams, expected, path="initial", author=sender):
            """Observe real intake, including same-SAID proof/path alternatives."""
            nests = [ipexing._normalizeNodeStream(stream) for stream in streams]
            parsedNests = [Parser().parse(ims=bytearray(nest), framed=False, processive=False)[0] for nest in nests]
            authentications = [dict(node=nest.serder.said, kind=node_verdict(nest)) for nest in parsedNests]
            wire = ipexing._sign(author, message, nests=nests)
            pathed = Pather(parts=["e", "credential"]).qb64b + Texter(text=path).qb64b
            authored = Parser().parse(ims=bytearray(wire), framed=False, processive=False)[0]
            # Source-owned framing includes the authored path inside the parent attachment enclosure.
            wire = serializeParsedSubstream(dict(authored.__dict__, ptds=[pathed]))
            parsed = Parser().parse(ims=bytearray(wire), framed=False, processive=False)
            assert parsed and parsed[0].serder.raw == message.raw
            assert len(parsed) == 1 and parsed[0].ptds == [pathed], "path must belong to the single parent enclosure"
            exc.latest = "not-dispatched"
            Parser().parse(ims=bytearray(wire), framed=False, exc=exc)
            assert exc.latest is None or isinstance(exc.latest, bool), "exactly one actual intake must run"
            accepted = receiver.db.exns.get((message.said,)) is not None
            outcome = "accept" if exc.latest is True else "escrow" if exc.latest is None else "reject"
            assert outcome == expected, (name, outcome, expected)
            observations = [dict(node=keys[1], **record.__dict__)
                            for keys, record in receiver.db.exrs.getTopItemIter(keys=(message.said,))]
            case = dict(name=name, through=len(support), wire=bytes(wire).decode(), said=message.said,
                        outcome=outcome, accepted=accepted, observations=observations, authentications=authentications)
            cases.append(case)

        reg, rip = registry("credential")
        credential = acdcmap(israid=issuer.pre, iseaid=issuer.pre, regid=reg.regk, attribute=dict(d="", role="member"))
        def advance(state):
            proof, event = registrar.issue(reg, acdc=credential, state=state, raw=b"0123456789abcdef", stamp=stamp)
            anchor(reg, event)
            return proof, event

        issued, event = advance("issued")
        message = grant("same Grant", [credential])
        receive("absent RIP escrows without observations", message, [proofed(credential, issued)], "escrow")
        publish(rip)
        receive("RIP-only future proof leaves no observations", message, [proofed(credential, issued)], "reject")
        publish(event)
        receive("issued first acceptance", message, [proofed(credential, issued)], "accept")
        revoked, event = advance("revoked")
        publish(event)
        receive("pending stale duplicate leaves issued observation", message, [proofed(credential, issued)], "escrow", "pending-current-opening")
        receive("revoked duplicate refreshes observation", message, [proofed(credential, revoked)], "accept", "fuller")
        withdrawn, event = advance("withdrawn")
        receive("future proof duplicate preserves revoked observation", message, [proofed(credential, withdrawn)], "reject", "pending")
        publish(event)
        receive("custom state duplicate refreshes observation", message, [proofed(credential, withdrawn)], "accept", "another")
        empty, event = advance("")
        publish(event)
        receive("empty state duplicate refreshes observation", message, [proofed(credential, empty)], "accept", "empty")
        separate = grant("different Grant", [credential])
        receive("different Grant has independent observations", separate, [proofed(credential, empty)], "accept", "separate")
        plain = acdcmap(israid=issuer.pre, attribute=dict(d="", role="plain"))
        receive("unregistered issuer proof has no registry observation", grant("plain", [plain]), [signed(plain)], "accept")

        optional, optionalRip = registry("optional")
        other = acdcmap(israid=issuer.pre, iseaid=issuer.pre, regid=optional.regk, attribute=dict(d="", role="optional"))
        otherProof, otherEvent = registrar.issue(optional, acdc=other, state="withdrawn", raw=b"0123456789abcdef", stamp=stamp)
        anchor(optional, otherEvent)
        rootNode = acdcmap(israid=issuer.pre, attribute=dict(d="", role="root"),
                           edge=dict(d="", o="OR", good=dict(d="", n=credential.said), other=dict(d="", n=other.said)))
        optionalGrant = grant("optional OR", [rootNode, credential, other])
        receive("optional missing child has no fabricated observation", optionalGrant,
                [signed(rootNode), proofed(credential, empty), proofed(other, otherProof)], "accept")
        publish(optionalRip)
        publish(otherEvent)
        receive("later optional authentication adds observation", optionalGrant,
                [signed(rootNode), proofed(credential, empty), proofed(other, otherProof)], "accept", "new-proof")
        receive("optional rejected child preserves prior recorded observation", optionalGrant,
                [signed(rootNode), proofed(credential, empty), other], "accept", "missing-proof")
        badRoot = grant("bad root proof", [credential])
        receive("missing current opening has no observation", badRoot, [credential], "escrow")
        receive("duplicate opening refuses without observations", grant("duplicate", [credential]), [proofed(credential, empty, empty)], "reject")
        receive("wrong target opening refuses without observations", grant("wrong target", [credential]), [proofed(credential, otherProof)], "reject")

        fresh, freshRip = registry("fresh")
        freshNode = acdcmap(israid=issuer.pre, iseaid=recipient.pre, regid=fresh.regk, attribute=dict(d="", role="fresh"))
        freshGrant = grant("fresh issuance", [freshNode], author=issuer)
        receive("absent RIP is not a fresh issuance candidate", freshGrant, [freshNode], "reject", author=issuer)
        publish(freshRip)
        receive("proofless fresh RIP issuance is pending", freshGrant, [freshNode], "escrow", author=issuer)
        receive("wrong discloser is not a fresh issuance candidate", grant("wrong discloser", [freshNode]), [freshNode], "reject")
        wrongIssuee = acdcmap(israid=issuer.pre, iseaid=issuer.pre, regid=fresh.regk, attribute=dict(d="", role="wrong issuee"))
        receive("wrong issuee is not a fresh issuance candidate", grant("wrong issuee", [wrongIssuee], author=issuer), [wrongIssuee], "reject", author=issuer)
        freshRoot = acdcmap(israid=issuer.pre, attribute=dict(d="", role="fresh OR"), edge=dict(d="", o="OR", good=dict(d="", n=credential.said), other=dict(d="", n=freshNode.said)))
        receive("eligible fresh issuance precedes valid OR", grant("fresh OR", [freshRoot, credential, freshNode], author=issuer), [signed(freshRoot), proofed(credential, empty), freshNode], "escrow", author=issuer)
        receive("ineligible fresh RIP does not defeat valid OR", grant("ineligible OR", [freshRoot, credential, freshNode]), [signed(freshRoot), proofed(credential, empty), freshNode], "accept")
        receive("fresh issuance refuses unauthenticated other node", grant("fresh unsafe OR", [freshRoot, credential, freshNode], author=issuer), [signed(freshRoot), credential, freshNode], "reject", author=issuer)
        placeholder1, up = registrar.vacate(reg, raw=b"0123456789abcdef", stamp=stamp)
        anchor(reg, up)
        publish(up)
        placeholder2, up = registrar.vacate(reg, raw=b"0123456789abcdef", stamp=stamp)
        anchor(reg, up)
        publish(up)
        suffixGrant = grant("placeholder suffix", [credential])
        receive("missing entire placeholder suffix is pending", suffixGrant, [proofed(credential, empty)], "escrow")
        receive("missing intermediate placeholder is pending", suffixGrant, [proofed(credential, empty, placeholder2)], "escrow")
        receive("missing preceding binding is pending", suffixGrant, [proofed(credential, placeholder1, placeholder2)], "escrow")
        receive("complete placeholder suffix authenticates empty state", suffixGrant, [proofed(credential, empty, placeholder1, placeholder2)], "accept")
        forged = SimpleNamespace(data=empty.data._replace(ts=Texter(text="forged")))
        receive("malformed supplied opening cannot become pending", grant("forged opening", [credential]), [proofed(credential, forged)], "reject")
        receive("malformed optional proof is structurally refused", grant("unused malformed OR", [rootNode, credential, other]), [signed(rootNode), proofed(credential, empty, placeholder1, placeholder2), proofed(other, forged)], "reject")
        receive("unused self-valid wrong-target proof permits valid OR", grant("unused wrong target OR", [rootNode, credential, other]), [signed(rootNode), proofed(credential, empty, placeholder1, placeholder2), proofed(other, empty)], "accept")

        for name, bd, expected in (("bound valid", issuer.kever.prefixer.qb64, "accept"), ("bound wrong", sender.kever.serder.said, "reject")):
            boundReg, boundRip = registry(name)
            boundNode = acdcmap(israid=issuer.pre, iseaid=issuer.pre, regid=boundReg.regk, attribute=dict(d="", role=name))
            # The issuer's accepted inception digest equals its digestive prefix.
            boundProof, up = registrar.issue(boundReg, acdc=boundNode, raw=b"0123456789abcdef", stamp=stamp, bound=True, bsn=0, bd=bd)
            anchor(boundReg, up)
            publish(boundRip)
            publish(up)
            receive(name + " historical issuee coordinate", grant(name, [boundNode]), [proofed(boundNode, boundProof)], expected)
        wrongReg, wrongRip = registry("wrong accepted target")
        wrongNode = acdcmap(israid=issuer.pre, iseaid=issuer.pre, regid=wrongReg.regk, attribute=dict(d="", role="wrong target"))
        wrongProof, up = registrar.present(wrongReg, grant=credential.said, raw=b"0123456789abcdef", stamp=stamp)
        anchor(wrongReg, up)
        publish(wrongRip)
        publish(up)
        receive("accepted opening for another target refuses", grant("accepted wrong target", [wrongNode]), [proofed(wrongNode, wrongProof)], "reject")
    finally:
        sourceRgy.close()
        receiverRgy.close()

pathlib.Path(sys.argv[1]).write_text(json.dumps(dict(reference=REFERENCE, modules=verify_source(), support=support, cases=cases), indent=2) + "\n")
