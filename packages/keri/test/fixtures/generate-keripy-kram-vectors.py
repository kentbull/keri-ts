"""Prepare independent KRAM intake/cache observations from frozen upstream."""
import hashlib
import json
import subprocess
import sys
from dataclasses import asdict
from datetime import datetime, timezone, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from keri import kering, recording
from keri.app import openHby
from keri.core import eventing, kraming, parsing, signing, coring, structing
from keri.help import helping

REFERENCE = "927c0cb8794d7c84fc17143c67df64aab9deda6c"
V2 = kering.Vrsn_2_0
CONFIG = {"kram": {"enabled": True, "caches": {"~": [1000, 5000, 60000, 300000, 5000, 60000, 300000]}}}


def provenance():
    """Compare actual imported modules with the immutable upstream commit."""
    root = Path(kraming.__file__).resolve().parents[3]
    assert subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() == REFERENCE
    result = {}
    for name, module in sorted(sys.modules.items()):
        if not (name == "keri" or name.startswith("keri.")) or not getattr(module, "__file__", None):
            continue
        if not module.__file__.endswith(".py"):
            continue
        path = Path(module.__file__).resolve()
        relative = str(path.relative_to(root))
        assert path.read_bytes() == subprocess.check_output(["git", "-C", str(root), "show", f"{REFERENCE}:{relative}"])
        result[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def parsed(wire):
    """Parse one fully enclosed wire message with the frozen progressive parser."""
    source = bytearray(wire + b"{")
    operation = parsing.Parser(version=V2).msgParsator(ims=source, framed=True)
    try:
        next(operation)
        raise AssertionError("Unexpected input request")
    except StopIteration as done:
        assert source == b"{"
        return done.value


def vectors():
    """Record partial accumulation, receiver times, duplicates and rotation cleanup."""
    clock = [datetime(2026, 10, 13, 12, tzinfo=timezone.utc)]
    rows = []
    kel = []
    with patch.object(helping, "nowUTC", lambda: clock[0]), openHby(name="kram-vector-sender", base="test", temp=True, salt=signing.Salter(raw=b"0123456789abcdef").qb64) as source, openHby(name="kram-vector-receiver", base="test", temp=True, salt=signing.Salter(raw=b"0123456789abcdeg").qb64) as target:
        sender = source.makeHab(name="sender", icount=3, isith="2", ncount=3, nsith="2", version=V2, kind="JSON")
        kvy = eventing.Kevery(db=target.db, lax=False, local=False)
        kramer = kraming.Kramer(target.db, cf=SimpleNamespace(get=lambda: CONFIG))
        prefix = coring.Prefixer(qb64=sender.pre)

        def learn(wire):
            """Use real event verification before KRAM consults current sender keys."""
            parsing.Parser(version=V2).parse(ims=bytearray(wire), kvy=kvy)
            kel.append(wire.decode())
        learn(sender.msgOwnEvent(sn=0, framed=True, gvrsn=V2))

        def message(ilk, name, prior="", xid=""):
            """Create a distinct JSON body with an explicit sender and timestamp."""
            if ilk == "qry":
                return eventing.query(pre=sender.pre, route="ksn", query={"i": sender.pre, "src": sender.pre, "n": name}, stamp=helping.nowIso8601(), pvrsn=V2, kind="JSON")
            return eventing.exchange(sender=sender.pre, receiver=sender.pre, xid=xid, prior=prior,
                                     route="/ipex/apply", modifiers={"n": name}, stamp=helping.nowIso8601(), pvrsn=V2, kind="JSON")

        def observe(name, msg, wire):
            """Record an actual parsed intake outcome without predicting the port's result."""
            kwa = vars(parsed(wire)).copy()
            body = kwa.pop("serder")
            cue_start = len(kramer.cues)
            error = None
            try:
                result = kramer.intake(body, kwa)
            except kering.KramError as ex:
                result, error = None, type(ex).__name__
            key = (body.pre, msg.said)
            xid = msg.ked.get("x")
            cache = target.db.kramTMSC.get((body.pre, xid, msg.said)) if xid else target.db.kramMSGC.get(key)
            record = target.db.kramXDT.get((xid,)) if xid else None
            rows.append(dict(name=name, now=helping.nowIso8601(), through=len(kel), wire=wire.decode(), ready=result is not None, error=error, nests=len(kwa.get("nests", [])),
                             cache=asdict(cache) if cache else None, opener=record.dts if record else None,
                             partial=target.db.kramPMKM.get(key) is not None,
                             partialSigs=[sig.qb64 for sig in target.db.kramPMKS.get(key)],
                             sigers=[sig.qb64 for sig in kwa.get("sigers", [])],
                             cigars=[dict(verfer=c.verfer.qb64, signature=c.qb64) for c in kwa.get("cigars", [])],
                             sources=[[n.qb64, d.qb64] for n, d in kwa.get("sscs", [])],
                             unresolved=[p.qb64 for p in kwa.get("ulgs", [])],
                             requests=[dict(sender=c["aid"], sn=c["sn"]) for c in kramer.cues[cue_start:] if c["kin"] == "keystate"],
                             groups=[dict(pre=p.qb64, number=n.qb64, digest=d.qb64, sigers=[sig.qb64 for sig in sigs]) for p,n,d,sigs in kwa.get("tsgs", [])]))

        def deliver(name, msg, indices, sigs=None):
            """Attach sender last-establishment groups through the real wire factory."""
            sigs = sigs or sender.mgr.sign(ser=msg.raw, verfers=sender.kever.verfers, indexed=True)
            wire = eventing.messagize(msg, lsgs=[(prefix, [sigs[i] for i in indices])], gvrsn=V2)
            observe(name, msg, wire)
        qry = message("qry", "partial-query")
        deliver("query first signature pending", qry, [0])
        deliver("repeated signature remains pending", qry, [0])
        clock[0] += timedelta(seconds=1)
        deliver("query threshold completes", qry, [2])
        deliver("query replay drops", qry, [0, 1, 2])
        xid = coring.Diger(ser=b"transaction opener").qb64
        exn = message("exn", "partial-transaction", xid=xid)
        deliver("transaction first signature has no receiver time", exn, [0])
        clock[0] += timedelta(seconds=1)
        deliver("transaction threshold freezes receiver time", exn, [1])
        deliver("transaction replay preserves receiver time", exn, [0, 1, 2])
        rotating = message("qry", "rotation-pending")
        old = sender.mgr.sign(ser=rotating.raw, verfers=sender.kever.verfers, indexed=True)
        deliver("partial before rotation", rotating, [0], old)
        learn(sender.rotate(framed=True, version=V2, kind="JSON", gvrsn=V2))
        deliver("rotation drops old partials but retains replay marker", rotating, [1], old)
        deliver("new keys cannot revive old message", rotating, [0, 1])
        sealed = message("exn", "source-seal")
        learn(sender.interact(data=[{"d": sealed.said}], version=V2, kind="JSON", gvrsn=V2))
        anchor = (coring.Number(num=sender.kever.sn), coring.Diger(qb64=sender.kever.serder.said))
        observe("accepted sender anchor authenticates an unsigned exchange", sealed,
                eventing.messagize(sealed, bonds=[structing.SealSource(*anchor)], gvrsn=V2))
        observe("source-only exchange replay drops", sealed,
                eventing.messagize(sealed, bonds=[structing.SealSource(*anchor)], gvrsn=V2))
        fallback = message("exn", "invalid-source-fallback")
        sigs = sender.sign(fallback.raw)
        wrong = (anchor[0], coring.Diger(ser=b"wrong source digest"))
        observe("invalid known source falls back to current sender threshold", fallback,
                eventing.messagize(fallback, bonds=[structing.SealSource(*wrong)], lsgs=[(prefix, sigs[:2])], gvrsn=V2))
        absent = message("exn", "missing-source")
        missing = (coring.Number(num=99), anchor[1])
        observe("missing source requests exact sender state and blocks signature fallback", absent,
                eventing.messagize(absent, bonds=[structing.SealSource(*missing)], lsgs=[(prefix, sender.sign(absent.raw)[:2])], gvrsn=V2))
        last = message("exn", "last-source")
        learn(sender.interact(data=[{"d": last.said}], version=V2, kind="JSON", gvrsn=V2))
        last_anchor = (coring.Number(num=sender.kever.sn), coring.Diger(qb64=sender.kever.serder.said))
        observe("last source reference overrides an earlier valid candidate", last,
                eventing.messagize(last, bonds=[structing.SealSource(*last_anchor), structing.SealSource(*wrong)], gvrsn=V2))
        foreign = source.makeHab(name="foreign", version=V2, kind="JSON")
        learn(foreign.msgOwnEvent(sn=0, framed=True, gvrsn=V2))
        shared = message("exn", "foreign-proofs")
        shared_sigs = sender.sign(shared.raw)
        observe("foreign signatures do not complete the sender threshold", shared,
                eventing.messagize(shared, lsgs=[(prefix, shared_sigs[:1]), (coring.Prefixer(qb64=foreign.pre), foreign.sign(shared.raw))], gvrsn=V2))
        observe("foreign last group survives partial storage as an explicit historical group", shared,
                eventing.messagize(shared, lsgs=[(prefix, shared_sigs[1:2])], gvrsn=V2))
        single = source.makeHab(name="single", version=V2, kind="JSON")
        learn(single.msgOwnEvent(sn=0, framed=True, gvrsn=V2))
        single_msg = eventing.exchange(sender=single.pre, receiver=sender.pre, route="/single",
                                      stamp=helping.nowIso8601(), pvrsn=V2, kind="JSON")
        single_wire = eventing.messagize(single_msg, lsgs=[(coring.Prefixer(qb64=single.pre), single.sign(single_msg.raw))], gvrsn=V2)
        observe("single-key sender is ready on first valid signature", single_msg, single_wire)
        observe("single-key replay drops", single_msg, single_wire)
        nontrans = source.makeHab(name="nontrans", transferable=False, version=V2, kind="JSON")
        learn(nontrans.msgOwnEvent(sn=0, framed=True, gvrsn=V2))
        cigar_msg = eventing.exchange(sender=nontrans.pre, receiver=sender.pre, route="/cigar",
                                     stamp=helping.nowIso8601(), pvrsn=V2, kind="JSON")
        observe("nontransferable sender cigar authenticates an exchange", cigar_msg,
                eventing.messagize(cigar_msg, cigars=nontrans.sign(cigar_msg.raw, indexed=False), gvrsn=V2))
        bad_cigar = eventing.exchange(sender=nontrans.pre, receiver=sender.pre, route="/bad-cigar",
                                     stamp=helping.nowIso8601(), pvrsn=V2, kind="JSON")
        observe("invalid sender cigar publishes no cache", bad_cigar,
                eventing.messagize(bad_cigar, cigars=nontrans.sign(b"wrong body", indexed=False), gvrsn=V2))
        for name, delta in (
            ("long acceptance lower boundary is inclusive", timedelta(milliseconds=-61000)),
            ("one microsecond before the lower boundary is refused", timedelta(milliseconds=-61000, microseconds=-1)),
            ("drift upper boundary is inclusive", timedelta(milliseconds=1000)),
            ("one microsecond after the drift boundary is refused", timedelta(milliseconds=1000, microseconds=1)),
        ):
            timed = eventing.exchange(sender=sender.pre, receiver=foreign.pre, route="/time",
                                     stamp=helping.toIso8601(clock[0] + delta), pvrsn=V2, kind="JSON")
            deliver(name, timed, [0, 1])
        unknown = message("exn", "unknown-thread-reply", prior=shared.said, xid=coring.Diger(ser=b"unknown thread").qb64)
        deliver("reply without a known thread opener is refused", unknown, [0, 1])
        thread = coring.Diger(ser=b"inclusive exchange lifetime").qb64
        opening = message("exn", "lifetime-open", xid=thread)
        deliver("exchange lifetime records its opener", opening, [0, 1])
        clock[0] += timedelta(milliseconds=300000)
        last_reply = message("exn", "lifetime-end", prior=opening.said, xid=thread)
        deliver("exchange lifetime upper boundary is inclusive", last_reply, [0, 1])
        clock[0] += timedelta(microseconds=1)
        expired = message("exn", "lifetime-expired", prior=last_reply.said, xid=thread)
        deliver("one microsecond after exchange lifetime is refused", expired, [0, 1])
        ordinary_count = len(rows)
        child = eventing.exchange(sender=sender.pre, route="/child", attributes={"words": ["nested"]},
                                  stamp=helping.nowIso8601(), pvrsn=kering.Vrsn_1_0, kind="JSON")
        child_wire = eventing.messagize(child, tsgs=[(prefix, coring.Number(num=sender.kever.lastEst.s),
                                      coring.Diger(qb64=sender.kever.lastEst.d), sender.sign(child.raw)[:2])],
                                      nested=True, gvrsn=V2)
        forward = eventing.exchange(sender=sender.pre, route="/fwd", modifiers={"pre": foreign.pre, "topic": "/nested"},
                                    attributes={"evt": coring.Diger(ser=child.raw).qb64},
                                    stamp=helping.nowIso8601(), pvrsn=V2, kind="JSON")
        parent_sigs = sender.sign(forward.raw)
        observe("first partial contains one nested child", forward,
                eventing.messagize(forward, lsgs=[(prefix, parent_sigs[:1])], nests=[child_wire], gvrsn=V2))
        observe("completion without retransmission loses the frozen reference child", forward,
                eventing.messagize(forward, lsgs=[(prefix, parent_sigs[1:2])], gvrsn=V2))
        nested_retention = rows[ordinary_count:]
        rows = rows[:ordinary_count]
    exemptions = []
    for name, denial, route in (
        ("version-only exempts exchange", [[2, 0], "", ""], "/ipex/apply"),
        ("type-only exemption keeps its type", [[2, 0], "rpy", ""], "/ipex/apply"),
        ("empty type with route is not a wildcard", [[2, 0], "", "/ipex"], "/ipex/apply"),
        ("type and route prefix exempts exchange", [[2, 0], "exn", "/ipex"], "/ipex/apply"),
    ):
        body = eventing.exchange(sender=sender.pre, receiver=sender.pre, route=route,
                                 pvrsn=V2, kind="JSON", stamp=helping.toIso8601(clock[0]))
        compact = kraming.Kramer._compactDenials([denial])
        exemptions.append(dict(name=name, denial=denial, body=body.raw.decode(),
                               exempt=any(kraming.Kramer.denial(body).startswith(d) for d in compact)))
    return dict(reference=REFERENCE, modules=provenance(), config=CONFIG, kel=kel, cases=rows, exemptions=exemptions, nestedRetention=nested_retention)


if __name__ == "__main__":
    provenance()
    print(json.dumps(vectors(), indent=2))
