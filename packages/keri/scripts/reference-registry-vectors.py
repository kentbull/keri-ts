"""Independent v2 registry decisions over real, signed KERIpy KEL evidence."""
import json
import pathlib
import subprocess
import sys
from keri import kering
from keri.app import habbing
from keri.core import Blinder, BoundState, SerderACDC, Salter, Diger
from keri.core import mapping
from keri.acdc import messaging, regeventing

REFERENCE = "927c0cb8794d7c84fc17143c67df64aab9deda6c"
# Frozen timestamp-cutoff cases retain historical behavior. Selected-candidate
# authenticated historical-head selection is qualified separately by parity row09.
root = pathlib.Path(regeventing.__file__).resolve().parents[3]


def verify_source():
    """Check the actual imported source before and after lazy runtime imports."""
    assert subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() == REFERENCE
    for name, module in list(sys.modules.items()):
        if (name == "keri" or name.startswith("keri.")) and getattr(module, "__file__", None):
            path = pathlib.Path(module.__file__).resolve()
            if path.suffix == ".py":
                assert path.read_bytes() == subprocess.check_output(["git", "-C", str(root), "show", f"{REFERENCE}:{path.relative_to(root)}"]), str(path)


verify_source()

stamp0 = "2026-10-13T01:00:00.000000+00:00"
stamp1 = "2026-10-13T01:00:01.000001+00:00"
stamp2 = "2026-10-13T01:00:01.000002+00:00"
stamp3 = "2026-10-13T01:00:01.000003+00:00"
salt = Salter(raw=b"0123456789abcdef").qb64
bodies, disclosures, wires, cases = {}, {}, [], []


def body(name, event):
    """Intern wire once so related failure branches stay compact and reviewable."""
    bodies[name] = event
    return event


def remake(name, event, **changes):
    """Produce a valid SAID for one deliberately wrong registry relationship."""
    sad = dict(event.sad)
    sad.update(changes)
    sad["d"] = ""
    return body(name, SerderACDC(sad=sad, makify=True))


def update(name, rip, prior, target, state, sn, stamp, bound=False):
    """Create actual blinded or bound state and its committed TEL update."""
    blind = Blinder.blind(acdc=target, state=state, salt=salt, sn=sn)
    if bound:
        blind = Blinder(crew=BoundState(d="", u=blind.uuid, td=target, ts=state, bn="0", bd=""), makify=True)
    disclosures[name] = blind
    return body(name, messaging.blindate(regid=rip.said, prior=prior.said, blid=blind.said, sn=sn, stamp=stamp))


def attributes(name):
    """Author the flat exposed attribute commitment before using the frozen builder."""
    return mapping.Compactor(mad=dict(d="", name=name), kind=kering.Kinds.json,
                             makify=True).mad


def anchor(hab, *events, data=None):
    """Record exact signed wire consumed independently by the TS KEL processor."""
    wires.append(bytes(hab.interact(data=data if data is not None else [dict(s=e.sad["n"], d=e.said) for e in events])).decode())
    return hab.kever.serder


reasons = {"MissequenceError": "sequence", "MisdigestError": "prior", "MisregistryError": "registry", "MisanchorError": "anchor", "RootSealError": "rootSeal", "DuplicitousRegistryError": "duplicity", "MisbindingError": "binding", "UnverifiedBlindError": "disclosure", "ValidationError": "event"}
with habbing.openHby(name="registry-vectors", temp=True, salt=salt) as hby:
    issuer = hby.makeHab(name="issuer")
    stranger = hby.makeHab(name="stranger")
    wires.extend(bytes(hab.msgOwnEvent(sn=0)).decode() for hab in (issuer, stranger))

    def case(name, rip="rip", updates=(), acdc=None, blinder=None, blinders=None, target=None, cutoff=None, source=None, controller=None, requireSource=False):
        """Run the unmodified reference and preserve its decision and complete state."""
        args = dict(rip=bodies[rip], updates=[bodies[key] for key in updates], db=hby.db)
        if acdc is not None:
            args["acdc"] = bodies[acdc]
        if source is not None:
            args["sources"] = {bodies[key].said: value for key, value in source.items()}
        if blinder is not None:
            args["blinder"] = disclosures[blinder]
        if blinders is not None:
            args.update(blinders=[disclosures[key] for key in blinders], target=bodies[target].said,
                        controller=controller, cutoff=cutoff, requireSource=requireSource)
        try:
            state = (regeventing.vetBinds if blinders is not None else regeventing.vet)(**args)._asdict()
            state["sn"] = str(state["sn"])
            outcome = dict(kind="verified", state=state)
        except kering.MissingAnchorError:
            outcome = dict(kind="missing", reason="anchor")
        except kering.ValidationError as error:
            outcome = dict(kind="reject", reason=reasons[type(error).__name__])
        cases.append(dict(name=name, through=len(wires), rip=rip, updates=list(updates), acdc=acdc,
                          blinder=blinder, blinders=blinders, target=target, cutoff=cutoff,
                          source=source, controller=controller, requireSource=requireSource, expected=outcome))

    rip = body("rip", messaging.regcept(israid=issuer.pre, uuid=salt, stamp=stamp0))
    anchor(issuer, data=[dict(d=rip.said)])
    acdc = body("acdc", messaging.acdcmap(israid=issuer.pre, regid=rip.said, attribute=attributes("Alice")))
    first = update("issued", rip, rip, acdc.said, "issued", 1, stamp1)
    case("inception")
    case("missing supplied update anchor", updates=["issued"], acdc="acdc", blinder="issued")
    first_anchor = anchor(issuer, first)
    case("issued mutual binding", updates=["issued"], acdc="acdc", blinder="issued")
    case("blinded head", updates=["issued"])
    case("undisclosed head cannot bind", updates=["issued"], acdc="acdc")
    remake("bad-n", rip, n="1")
    remake("gap", first, n="2")
    remake("wrong-prior", first, p=first.said)
    remake("wrong-registry", first, rd=first.said)
    for name, r, us in [("nonzero inception", "bad-n", []), ("gap", "rip", ["gap"]), ("wrong prior", "rip", ["wrong-prior"]), ("wrong registry", "rip", ["wrong-registry"])]:
        case(name, rip=r, updates=us)
    body("substitute", messaging.acdcmap(israid=issuer.pre, regid=rip.said, attribute=attributes("Mallory")))
    case("substituted credential", updates=["issued"], acdc="substitute", blinder="issued")
    disclosures["tampered"] = Blinder(crew=disclosures["issued"].crew._replace(ts="revoked"), verify=False)
    case("stale disclosure digest", updates=["issued"], blinder="tampered")
    case("explicit source by digest", updates=["issued"], source={"issued": first_anchor.said})
    case("wrong hint falls back", updates=["issued"], source={"issued": 0})
    foreign = anchor(issuer, data=[dict(d=Diger(ser=b"aggregate root").qb64)])
    case("aggregate root source", updates=["issued"], source={"issued": foreign.sn})
    wrong = body("stranger-rip", messaging.regcept(israid=issuer.pre, uuid=salt, stamp=stamp1))
    anchor(stranger, wrong)
    case("stranger endorsement", rip="stranger-rip")
    competing = update("competing", rip, rip, acdc.said, "revoked", 1, stamp2)
    case("unanchored competing event", updates=["issued", "competing"])
    anchor(issuer, competing)
    case("anchored duplicity", updates=["competing", "issued"])
    vacuous = update("vacuous", rip, first, "", "", 2, stamp2)
    revoked = update("revoked", rip, vacuous, acdc.said, "revoked", 3, stamp3)
    anchor(issuer, vacuous, revoked)
    case("unordered duplicate chain", updates=["revoked", "issued", "vacuous", "issued"], acdc="acdc", blinder="revoked")
    case("historical binding behind vacuous head", updates=["issued", "vacuous", "revoked"], acdc="acdc", blinders=["issued", "vacuous"], target="acdc", cutoff=stamp2)
    case("microsecond cutoff", updates=["issued", "vacuous", "revoked"], blinders=["issued"], target="acdc", cutoff=stamp1)
    case("missing intervening disclosure", updates=["issued", "vacuous"], blinders=["issued"], target="acdc")
    case("duplicate disclosure", updates=["issued"], blinders=["issued", "issued"], target="acdc")
    case("required binding source absent", updates=["issued"], blinders=["issued"], target="acdc", requireSource=True)
    case("required binding source supplied", updates=["issued"], blinders=["issued"], target="acdc", source={"issued": first_anchor.sn}, requireSource=True)
    bound = update("bound", rip, rip, acdc.said, "issued", 1, stamp3, bound=True)
    anchor(issuer, bound)
    case("bound state", updates=["bound"], acdc="acdc", blinder="bound")
    # Each binding rule has an independent target commitment, so equality of the
    # target SAID cannot mask a wrong issuer or credential-to-registry link.
    for key, owner, regid in [("oneway", issuer, None), ("wrong-issuer", stranger, rip.said), ("wrong-rd", issuer, first.said)]:
        credential = body(key, messaging.acdcmap(israid=owner.pre, regid=regid, attribute=attributes("Alice")))
        event = update(key, rip, rip, credential.said, "issued", 1, stamp3)
        # update() interns the event separately from the presented credential.
        bodies[key + "-acdc"] = credential
        anchor(issuer, event)
        case(key, updates=[key], acdc=key + "-acdc", blinder=key)

verify_source()
json.dump(dict(reference=REFERENCE, bodies={key: value.raw.decode() for key, value in bodies.items()},
               disclosures={key: dict(value.crew._asdict()) for key, value in disclosures.items()},
               wires=wires, cases=cases), sys.stdout, indent=2)
print()
print(f"reference={REFERENCE} python={sys.version.split()[0]} module={regeventing.__file__}", file=sys.stderr)
