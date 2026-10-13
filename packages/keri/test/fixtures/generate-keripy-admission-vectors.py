"""Exercise frozen processMsg dispatch after parsing independently signed wire.

Callbacks record delegation only: these fixtures do not claim route verification
or KRAM qualification. Run with unmodified upstream 927c0cb8 on PYTHONPATH.
"""
import hashlib
import json
import subprocess
from pathlib import Path
from types import SimpleNamespace

from keri import kering
from keri.core import coring, counting, eventing, parsing, serdering, signing, structing

# Freeze upstream source rather than the installed interpreter environment.
REFERENCE = "927c0cb8794d7c84fc17143c67df64aab9deda6c"


def provenance():
    """Verify actual imported source, including lazy imports, against the pin."""
    root = Path(eventing.__file__).resolve().parents[3]
    assert subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() == REFERENCE
    result = {}
    for module in (coring, counting, eventing, parsing, serdering, signing, structing):
        path = Path(module.__file__).resolve()
        rel = str(path.relative_to(root))
        assert path.read_bytes() == subprocess.check_output(["git", "-C", str(root), "show", f"{REFERENCE}:{rel}"])
        result[rel] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def parse(wire):
    """Use a following-body sniff to close bare fixtures without consuming it."""
    source = bytearray(wire + b"{")
    operation = parsing.Parser(version=kering.Vrsn_2_0).msgParsator(ims=source, framed=True)
    try:
        next(operation)
        raise AssertionError("Unexpected input request")
    except StopIteration as done:
        assert source == b"{"
        return done.value


def vectors():
    """Observe policy precedence, proof prerequisites, query ownership and stubs."""
    signer = signing.Signer(raw=bytes(range(32)))
    other = signing.Signer(raw=bytes([1]) * 32)
    inception = eventing.incept(keys=[signer.verfer.qb64], pvrsn=kering.Vrsn_2_0, kind="JSON")
    prefix = coring.Prefixer(qb64=inception.pre)
    rows = []

    def case(name, ilk, route="", proof="none", allow=(), deny=(), processor=True):
        """Parse real wire and invoke upstream processMsg with recording consumers."""
        body = serdering.SerderKERI(sad=dict(i=inception.pre, dt="2026-10-13T00:00:00.000000+00:00", r=route),
                                  ilk=ilk, makify=True, pvrsn=kering.Vrsn_2_0, kind="JSON")
        sig = signer.sign(body.raw, index=0)
        if proof == "group":
            wire = eventing.messagize(body, tsgs=[(prefix, coring.Number(num=0), coring.Diger(qb64=inception.said), [sig])], gvrsn=kering.Vrsn_2_0)
        elif proof == "last":
            wire = eventing.messagize(body, lsgs=[(prefix, [sig])], gvrsn=kering.Vrsn_2_0)
        elif proof == "raw":
            wire = eventing.messagize(body, sigers=[sig], gvrsn=kering.Vrsn_2_0)
        elif proof == "source":
            wire = eventing.messagize(body, bonds=[structing.SealSource(coring.Number(num=0), coring.Diger(qb64=inception.said))], gvrsn=kering.Vrsn_2_0)
        else:
            wire = body.raw
        exts = parse(wire)
        observed = []
        def record(target):
            """Capture only the upstream delegation and normalized requester."""
            def receive(serder, **kwa):
                """Record the selected processor and its requester proof projection."""
                observed.append(dict(target=target, source=kwa.get("source").qb64 if kwa.get("source") else None,
                                     sigers=[sig.qb64 for sig in kwa.get("sigers", [])]))
            return receive
        kvy = eventing.Kevery.__new__(eventing.Kevery)
        kvy.allowList, kvy.denyList = set(allow), set(deny)
        kvy.kramer = None
        kvy.rvy = SimpleNamespace(processReply=record("reply"))
        kvy.exc = SimpleNamespace(processEvent=record("exchange")) if processor else None
        kvy.tvy = SimpleNamespace(processQuery=record("tel-query")) if processor else None
        kvy.processQuery = record("kel-query")
        error = None
        try:
            kvy.processMsg(kwa=vars(exts).copy())
        except kering.ValidationError as ex:
            error = type(ex).__name__
        rows.append(dict(name=name, wire=wire.decode(), allow=list(allow), deny=list(deny), processor=processor,
                         observed=observed, error=error))

    case("raw query sender", "qry", "ksn", "raw")
    case("last query sender", "qry", "logs", "last")
    case("allowed sender", "qry", "mbx", "raw", allow=[inception.pre])
    case("deny wins", "qry", "ksn", "raw", allow=[inception.pre], deny=[inception.pre])
    case("allow excludes sender", "qry", "ksn", "raw", allow=[other.verfer.qb64])
    case("unsigned query", "qry", "ksn")
    case("unknown query route", "qry", "unknown", "raw")
    for route in ("tels", "tsn"):
        case(f"{route} owner", "qry", route, "raw")
    case("missing TEL owner", "qry", "tels", "raw", processor=False)
    case("signed reply", "rpy", "/end/role/add", "group")
    case("unsigned reply", "rpy", "/end/role/add")
    case("signed exchange", "exn", "/challenge/response", "group")
    case("anchored exchange", "exn", "/fwd", "source")
    case("unsigned exchange", "exn", "/fwd")
    case("last group alone is not EXN admission", "exn", "/fwd", "last")
    case("missing exchange owner", "exn", "/fwd", "group", processor=False)
    for ilk in ("xip", "pro", "bar"):
        case(f"{ilk} reference stub", ilk)
        case(f"{ilk} denied", ilk, deny=[inception.pre])
    return dict(reference=REFERENCE, modules=provenance(), cases=rows)


if __name__ == "__main__":
    provenance()
    print(json.dumps(vectors(), indent=2))
