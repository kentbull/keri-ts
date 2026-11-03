"""Literal disclosure paths, complete BFS selection and whole-node checks from Python.

Run on the pinned source archive with Docker-owned temporary state. Credentials
use ordinary constructors; all signing happens after authored disclosure selection.
"""
import hashlib
import json
import pathlib
import subprocess
import sys
from keri import Kinds, Vrsn_2_0
from keri.app import openHby
from keri.core import Diger, Noncer, Number, Parser, Salter, Schemer, exchept, exchange, messagize
from keri.acdc import acdcagg, acdcmap, ipexing
from keri.peer import Exchanger

REFERENCE = "550f401489488a5fec6e1b847e74bf8312f647ca"
root = pathlib.Path(ipexing.__file__).resolve().parents[3]


def verify_source():
    """Verify every imported module, including lazy imports after intake."""
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
    """Capture actual parser-driven attempts separately from durable acceptance."""
    latest = None

    def processEvent(self, *args, **kwa):
        self.latest = super().processEvent(*args, **kwa)
        return self.latest


verify_source()
wires, cases = [], []
stamp = "2026-10-13T01:00:00.000000+00:00"
with openHby(name="disclosure-vectors", temp=True, salt=Salter(raw=b"0123456789abcdef").qb64) as hby:
    issuer, sender, recipient = (hby.makeHab(name=name) for name in ("issuer", "sender", "recipient"))
    for hab in (issuer, sender, recipient):
        wires.append(bytes(hab.msgOwnEvent(sn=0, framed=False, gvrsn=Vrsn_2_0)).decode())
    exc = RecordingExchanger(hby=hby, handlers=[])
    ipexing.loadHandlers(hby=hby, exc=exc, notifier=None)

    def signed(body):
        return messagize(serder=body, tsgs=[(issuer.kever.prefixer, Number(sn=issuer.kever.lastEst.s),
                         Diger(qb64=issuer.kever.lastEst.d), issuer.sign(ser=body.raw, indexed=True))],
                         framed=False, gvrsn=Vrsn_2_0)

    def schema_id(body):
        return body.schema if isinstance(body.schema, str) else body.schema["$id"]

    def emit(name, expected, *, nodes=(), dp=(), verb="grant", prior=None, from_hab=None):
        """Record exact authored wire and the real route outcome; no intake rewriting."""
        hab = from_hab or sender
        attrs = dict(m=name)
        if verb in ("grant", "offer"):
            attrs["o"] = [nodes[0].said] if nodes else []
        kwa = dict(sender=hab.pre, receiver=prior.pre if prior else sender.pre if hab is recipient else recipient.pre, route=f"/ipex/{verb}",
                   attributes=attrs, modifiers=dict(dp=[list(dp)]), stamp=stamp, kind=Kinds.json,
                   pvrsn=Vrsn_2_0, gvrsn=Vrsn_2_0)
        body = (exchange(xid=prior.said if prior.ilk == "xip" else prior.sad["x"], prior=prior.said, **kwa)
                if prior else exchept(nonce=Noncer(raw=Diger(ser=name.encode()).raw[:16]).qb64, **kwa))
        streams = [signed(node) if verb == "grant" else node for node in nodes]
        wire = ipexing._sign(hab, body, nests=[ipexing._normalizeNodeStream(stream) for stream in streams])
        parsed = Parser().parse(ims=bytearray(wire), framed=False, processive=False)
        assert len(parsed) == 1 and parsed[0].serder.raw == body.raw
        exc.latest = "not-dispatched"
        Parser().parse(ims=bytearray(wire), framed=False, exc=exc)
        assert exc.latest is None or isinstance(exc.latest, bool)
        outcome = "accept" if exc.latest is True else "escrow" if exc.latest is None else "reject"
        assert outcome == expected, (name, outcome, expected)
        cases.append(dict(name=name, wire=bytes(wire).decode(), said=body.said, outcome=outcome))
        return body

    def node(role, *, edge=None, attribute=None, schema=None):
        return acdcmap(israid=issuer.pre, iseaid=issuer.pre,
                       attribute=attribute if attribute is not None else dict(d="", role=role),
                       edge=edge, schema=schema)

    def edge(**targets):
        return dict(d="", **{name: dict(d="", n=far.said) for name, far in targets.items()})

    full = node("full")
    single = [[schema_id(full), "/", []]]
    emit("empty DAG prefix Apply", "reject", verb="apply", dp=[[schema_id(full), "", []]])
    emit("empty DAG prefix Grant", "reject", nodes=[full], dp=[[schema_id(full), "", []]])
    emit("explicit root presence", "accept", nodes=[full], dp=single)
    emit("default-schema whole node", "accept", nodes=[full], dp=[[schema_id(full), "/", [""]]])
    open_schema = Schemer(sed={"$id": "", "version": "1.0.0", "type": "object"})
    opened = node("open", schema=open_schema.sed)
    emit("open-schema whole node", "accept", nodes=[opened], dp=[[schema_id(opened), "/", [""]]])
    compact = node("full", attribute=full.sad["a"]["d"], schema=full.schema)
    assert compact.said == full.said
    emit("presence permits compact attribute", "accept", nodes=[compact], dp=single)
    emit("whole node refuses compact attribute", "reject", nodes=[compact], dp=[[schema_id(full), "/", [""]]])
    nested_full = node("nested", attribute=dict(d="", role="nested", profile=dict(d="", value="visible")))
    nested_compact = node("nested", attribute=dict(d="", role="nested", profile=nested_full.sad["a"]["profile"]["d"]), schema=nested_full.schema)
    assert nested_compact.said == nested_full.said
    emit("whole checks expanded top-level sections", "accept", nodes=[nested_compact], dp=[[schema_id(nested_compact), "/", [""]]])
    emit("d slash cannot traverse a compact attribute", "reject", nodes=[compact], dp=[[schema_id(full), "/", ["d/"]]])
    emit("d slash cannot traverse a primitive SAID", "reject", nodes=[full], dp=[[schema_id(full), "/", ["d/"]]])
    emit("expanded attribute subtree", "accept", nodes=[full], dp=[[schema_id(full), "/", ["a/"]]])
    emit("subtree does not infer schema-hidden maps", "accept", nodes=[nested_compact], dp=[[schema_id(nested_compact), "/", ["a/"]]])
    emit("explicit attribute path", "accept", nodes=[full], dp=[[schema_id(full), "/", ["a/role"]]])
    emit("missing attribute path", "reject", nodes=[full], dp=[[schema_id(full), "/", ["a/missing"]]])
    aggregate = acdcagg(israid=issuer.pre, aggregate=["", dict(d="", role="aggregate")])
    emit("whole aggregate", "accept", nodes=[aggregate], dp=[[schema_id(aggregate), "/", [""]]])
    compact_aggregate = acdcagg(israid=issuer.pre, aggregate=aggregate.sad["A"][0], schema=aggregate.schema)
    assert compact_aggregate.said == aggregate.said
    emit("presence permits compact aggregate", "accept", nodes=[compact_aggregate], dp=[[schema_id(aggregate), "/", []]])
    emit("whole node refuses compact aggregate", "reject", nodes=[compact_aggregate], dp=[[schema_id(aggregate), "/", [""]]])

    tail = node("tail")
    left = node("left", edge=edge(tail=tail), attribute=dict(d="", role="left", alias=dict(d="", n=tail.said, context="literal data")))
    right = node("right", edge=edge(tail=tail))
    origin = node("origin", edge=edge(first=left, second=right),
                  attribute=dict(d="", role="origin", alias=dict(d="", n=left.said, context="literal data")))
    nodes = [origin, left, right, tail]
    paths = ["/", "/e/first/_/", "/e/second/_/", "/e/first/_/e/tail/_/"]
    plan = [[schema_id(body), path, []] for body, path in zip(nodes, paths)]
    emit("complete BFS shared-tail graph", "accept", nodes=nodes, dp=plan)
    emit("shared tail selected through alternate edge", "accept", nodes=nodes, dp=plan[:3] + [[schema_id(tail), "/e/second/_/e/tail/_/", []]])
    emit("root-only plan omits disclosed nodes", "reject", nodes=nodes, dp=plan[:1])
    emit("plan omits middle BFS node", "reject", nodes=nodes, dp=[plan[0], plan[2], plan[3]])
    emit("plan omits final BFS node", "reject", nodes=nodes, dp=plan[:3])
    emit("plan reorders BFS nodes", "reject", nodes=nodes, dp=[plan[0], plan[2], plan[1], plan[3]])
    emit("plan duplicates shared node", "reject", nodes=nodes, dp=plan + [[schema_id(tail), "/e/second/_/e/tail/_/", []]])
    emit("plan cannot omit origin", "reject", nodes=nodes, dp=plan[1:])
    emit("literal attribute map hop", "accept", nodes=nodes, dp=[plan[0], [schema_id(left), "/a/alias/_/", []], *plan[2:]])
    emit("literal map hop after far-node transition", "accept", nodes=nodes,
         dp=plan[:3] + [[schema_id(tail), "/e/first/_/a/alias/_/", []]])
    for prefix in ("/e/first/", "e/first/_/", "/e//first/_/", "/a/missing/_/"):
        emit(f"invalid or unresolved prefix {prefix}", "reject", nodes=nodes,
             dp=[plan[0], [schema_id(left), prefix, []], *plan[2:]])
    emit("empty opener plan", "accept", verb="apply")
    emit("empty Grant plan", "accept")
    apply = emit("complete plan Apply", "accept", verb="apply", dp=plan, from_hab=recipient)
    offer = emit("inherited plan Offer", "accept", verb="offer", dp=[], nodes=nodes, prior=apply)
    agree = emit("inherited plan Agree", "accept", verb="agree", dp=[], prior=offer, from_hab=recipient)
    emit("inherited complete plan Grant", "accept", dp=[], nodes=nodes, prior=agree)

pathlib.Path(sys.argv[1]).write_text(json.dumps(dict(reference=REFERENCE, modules=verify_source(), wires=wires, cases=cases), indent=2) + "\n")
