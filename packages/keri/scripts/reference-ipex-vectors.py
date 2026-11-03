"""Independent XIP/EXN and one-DAG IPEX wire and decisions from pinned v2-spec."""
import copy
import hashlib
import json
import pathlib
import subprocess
import sys
from keri import Kinds, Vrsn_2_0
from keri.app import openHby
from keri.core import Compactor, Diger, Noncer, Number, Parser, Salter, Schemer, SealSource, SerderACDC, exchange, exchept, messagize
from keri.acdc import acdcmap, ipexing
from keri.peer import Exchanger

REFERENCE = "ae8284995486855809e7f4988fa1579b63e1ff91"
root = pathlib.Path(ipexing.__file__).resolve().parents[3]


def verify_source():
    """Check actual imported modules, including imports triggered by execution."""
    modules = {}
    for name, module in list(sys.modules.items()):
        if (name == "keri" or name.startswith("keri.")) and getattr(module, "__file__", None):
            path = pathlib.Path(module.__file__).resolve()
            if path.suffix == ".py":
                imported = path.read_bytes()
                assert imported == subprocess.check_output(["git", "-c", f"safe.directory={root}", "-C", str(root), "show", f"{REFERENCE}:{path.relative_to(root)}"]), str(path)
                modules[str(path.relative_to(root))] = hashlib.sha256(imported).hexdigest()
    return dict(sorted(modules.items()))


def committed_acdcmap(**kwa):
    """Prepare disclosed section claims using Python owners before any signature.

    acdcmap currently preserves supplied empty/stale section claims. Wire/chain
    positives prepare those claims explicitly; separate cases retain the common
    constructor output verbatim so this unresolved interoperability gap stays visible.
    """
    node = acdcmap(**kwa)
    sad = copy.deepcopy(node.sad)
    for label in ("a", "e", "r"):
        section = sad.get(label)
        if isinstance(section, dict) and section:
            compactor = Compactor(mad=section, makify=True, kind=node.kind)
            compactor.compact()
            compactor.expand()
            sad[label] = list(compactor.partials.values())[-1].mad
    prepared = SerderACDC(sad=sad, makify=True)
    assert prepared.said == node.said, "preparing section claims must preserve credential identity"
    return prepared


class Recorder:
    """Expose only durable post-acceptance route notifications."""
    def __init__(self):
        self.items = []

    def add(self, attrs):
        self.items.append(attrs)


verify_source()
wires, cases = [], []
salt = Salter(raw=b"0123456789abcdef").qb64
stamp = "2026-10-13T01:00:00.000000+00:00"
with openHby(name="ipex-vectors", temp=True, salt=salt) as hby:
    issuer = hby.makeHab(name="issuer")
    holder = hby.makeHab(name="holder")
    recipient = hby.makeHab(name="recipient")
    nontrans = hby.makeHab(name="nontrans", transferable=False)
    recorder = Recorder()
    exc = Exchanger(hby=hby, handlers=[])
    ipexing.loadHandlers(hby=hby, exc=exc, notifier=recorder)
    wires.extend(bytes(hab.msgOwnEvent(sn=0)).decode() for hab in (issuer, holder, recipient, nontrans))

    def signed(node, hab=issuer, data=None, bonds=None):
        """Sign the child body independently of every outer exchange."""
        if not hab.kever.prefixer.transferable:
            return messagize(serder=node, cigars=hab.sign(ser=node.raw, indexed=False), framed=False, gvrsn=Vrsn_2_0)
        return messagize(serder=node, tsgs=[(hab.kever.prefixer, Number(sn=hab.kever.lastEst.s),
                         Diger(qb64=hab.kever.lastEst.d), hab.sign(ser=node.raw if data is None else data, indexed=True))],
                         bonds=bonds, framed=False, gvrsn=Vrsn_2_0)

    def edge(label, node, op=None):
        """A disclosed edge whose far node has its own issuer proof."""
        leaf = dict(d="", n=node.said)
        if op is not None:
            leaf["o"] = op
        return dict(d="", **{label: leaf})

    origin = committed_acdcmap(israid=issuer.pre, iseaid=holder.pre, attribute=dict(d="", role="member"))
    schema = origin.schema["$id"]
    plan = [[schema, "/", []]]

    def emit(name, verb="grant", nodes=None, dp=None, attrs=None, prior=None, sender=holder, to=None, endorsers=None):
        """Run parser plus real Exchanger and record the accepted/escrow/rejected result."""
        data = dict(m=name)
        if verb == "grant":
            data["o"] = [ipexing._streamSerder(nodes[0]).said] if nodes else []
        elif verb == "offer" and nodes:
            data["o"] = [ipexing._streamSerder(nodes[0]).said]
        data.update(attrs or {})
        q = dict(dp=[plan if dp is None else dp]) if verb in ("apply", "offer", "agree", "grant") else {}
        arguments = dict(sender=sender.pre, receiver=to or (prior.pre if prior else recipient.pre),
                         route=f"/ipex/{verb}", modifiers=q,
                         stamp=stamp, attributes=data, pvrsn=Vrsn_2_0, gvrsn=Vrsn_2_0, kind=Kinds.json)
        if prior:
            xid = prior.said if prior.ilk == "xip" else prior.sad["x"]
            body = exchange(xid=xid, prior=prior.said, **arguments)
        else:
            body = exchept(nonce=Noncer(raw=Diger(ser=name.encode()).raw[:16]).qb64, **arguments)
        wire = ipexing._sign(sender, body, nests=[ipexing._normalizeNodeStream(n) for n in nodes or []], endorsers=endorsers)
        parsed = Parser().parse(ims=bytearray(wire), framed=False, processive=False)
        assert parsed is not None and len(parsed) == 1, name
        Parser().parse(ims=bytearray(wire), framed=False, exc=exc)
        outcome = "accept" if hby.db.exns.get(keys=(body.said,)) else "escrow" if hby.db.epse.get(keys=(body.said,)) else "reject"
        case = dict(name=name, through=len(wires), wire=bytes(wire).decode(), said=body.said, outcome=outcome)
        if name in ("issuer proof under a different outer sender", "stale exposed section claim"):
            case["pythonSectionVerifies"] = ipexing._streamSerder(nodes[0]).verify()
        cases.append(case)
        return body

    emit("prepared issuer proof under a different outer sender", nodes=[signed(origin)])
    raw_origin = acdcmap(israid=issuer.pre, iseaid=holder.pre, attribute=dict(d="", role="member"))
    emit("issuer proof under a different outer sender", nodes=[signed(raw_origin)])
    stale = copy.deepcopy(raw_origin.sad)
    stale["a"]["d"] = Diger(ser=b"unrelated section claim").qb64
    emit("stale exposed section claim", nodes=[signed(SerderACDC(sad=stale, makify=True))])
    emit("outer signatures do not authenticate unsigned children", nodes=[origin])
    emit("tampered child signature", nodes=[signed(origin, data=b"different credential")])
    emit("foreign child signer", nodes=[signed(origin, holder)])
    emit("wrong origin commitment", nodes=[signed(origin)], attrs=dict(o=[issuer.pre]))
    # Whole disclosure needs a closed typed schema in the selected candidate profile.
    scalar = {"type": "string"}
    whole_schema = Schemer(sed={
        "$id": "", "$schema": "https://json-schema.org/draft/2020-12/schema",
        "version": "1.0.0", "type": "object",
        "required": ["v", "t", "d", "i", "s", "a"],
        "properties": {
            "v": scalar, "t": {"type": "string", "const": "acm"},
            "d": scalar, "i": scalar,
            "s": {"oneOf": [scalar, {"type": "object"}]},
            "a": {"type": "object", "required": ["d", "i", "role"],
                  "properties": {"d": scalar, "i": scalar, "role": scalar},
                  "additionalProperties": False},
        },
        "additionalProperties": False,
    })
    whole = committed_acdcmap(israid=issuer.pre, iseaid=holder.pre, schema=whole_schema.sed,
                    attribute=dict(d="", role="member"))
    emit("whole disclosure", nodes=[signed(whole)], dp=[[whole_schema.said, "/", [""]]])
    assert cases[-1]["outcome"] == "accept", "closed typed whole disclosure remains positive"
    emit("requested canonical attribute path", nodes=[signed(origin)], dp=[[schema, "/", ["a/role"]]])
    nontrans_node = committed_acdcmap(israid=nontrans.pre, iseaid=holder.pre, attribute=dict(d="", role="member"))
    emit("nontransferable child issuer", nodes=[signed(nontrans_node, nontrans)], dp=[[nontrans_node.schema["$id"], "/", []]])
    emit("requested missing field", nodes=[signed(origin)], dp=[[schema, "/", ["a/missing"]]])
    emit("wrong schema obligation", nodes=[signed(origin)], dp=[[issuer.pre, "/", []]])
    emit("vacuous grant", dp=[])
    assert cases[-1]["outcome"] == "accept", "an explicitly empty opener discloses nothing"
    emit("empty plan cannot carry a child", nodes=[signed(origin)], dp=[])
    emit("grant optional foreign evidence", nodes=[signed(origin)], endorsers=[issuer])
    emit("apply rejects foreign evidence", verb="apply", endorsers=[issuer])
    emit("apply empty schema identifier", verb="apply", dp=[["", "/", []]])

    far = committed_acdcmap(israid=issuer.pre, iseaid=issuer.pre, attribute=dict(d="", role="authority"))
    near = committed_acdcmap(israid=issuer.pre, iseaid=holder.pre, attribute=dict(d="", role="member"), edge=edge("authority", far, "I2I"))
    graph_plan = [[near.schema["$id"], "/", []], [far.schema["$id"], "/e/authority/_/", []]]
    emit("closed graph with per-node issuer proofs", nodes=[signed(near), signed(far)], dp=graph_plan)
    emit("closed graph cannot omit far node", nodes=[signed(near)], dp=graph_plan)
    emit("far node needs its own proof", nodes=[signed(near), far], dp=graph_plan)
    emit("metadata offer may omit far node and issuer proofs", verb="offer", nodes=[near], dp=graph_plan)
    emit("unreachable extra node", nodes=[signed(origin), signed(far)])
    emit("duplicate node", nodes=[signed(origin), signed(origin)])
    emit("disclosure order follows breadth first graph", nodes=[signed(near), signed(far)], dp=list(reversed(graph_plan)))
    # Unevaluated reference stubs are not parity requirements for TS operator support.
    for op in ("E1E", "NI2I"):
        node = committed_acdcmap(israid=issuer.pre, iseaid=holder.pre, attribute=dict(d="", role="member"), edge=edge("authority", far, op))
        dp = [[node.schema["$id"], "/", []], [far.schema["$id"], "/e/authority/_/", []]]
        emit(f"edge operator {op}", nodes=[signed(node), signed(far)], dp=dp)

    for operator in ("AND", "OR"):
        edges = dict(d="", o=operator, good=dict(d="", n=far.said, o="I2I"), mismatch=dict(d="", n=origin.said, o="I2I"))
        grouped = committed_acdcmap(israid=issuer.pre, iseaid=holder.pre, attribute=dict(d="", role="member"), edge=edges)
        dp = [[grouped.schema["$id"], "/", []], [far.schema["$id"], "/e/good/_/", []], [schema, "/e/mismatch/_/", []]]
        emit(f"edge group {operator}", nodes=[signed(grouped), signed(far), signed(origin)], dp=dp)

    apply = emit("linear apply", verb="apply", sender=recipient, to=holder.pre)
    offer = emit("linear metadata offer", verb="offer", nodes=[origin], dp=[], prior=apply)
    agree = emit("linear agree ditto", verb="agree", dp=[], prior=offer, sender=recipient)
    emit("grant cannot renegotiate prior", nodes=[signed(origin)], dp=[[schema, "/", [""]]], prior=agree)
    grant = emit("linear grant ditto", nodes=[signed(origin)], dp=[], prior=agree)
    emit("linear admit", verb="admit", prior=grant, sender=recipient)
    emit("second response refused", verb="admit", prior=grant, sender=recipient)
    direct = emit("direct apply", verb="apply", sender=recipient, to=holder.pre)
    emit("direct apply to grant", nodes=[signed(origin)], dp=[], prior=direct)
    bare = emit("spurnable opener", nodes=[signed(origin)])
    emit("spurn opener", verb="spurn", prior=bare, sender=recipient)

    # A supplied invalid anchor selects the anchor factor and cannot fall back to signatures.
    invalid = SealSource(s="0", d=issuer.kever.serder.said)
    emit("invalid selected issuer anchor defeats good signature", nodes=[signed(origin, bonds=[invalid])])
    anchor = issuer.interact(data=[dict(d=origin.said)])
    wires.append(bytes(anchor).decode())
    seal = SealSource(s=issuer.kever.serder.snh, d=issuer.kever.serder.said)
    emit("valid direct issuer anchor", nodes=[messagize(serder=origin, bonds=[seal], framed=False, gvrsn=Vrsn_2_0)])
    old = signed(origin)
    wires.append(bytes(issuer.rotate()).decode())
    emit("stale explicit issuer keys", nodes=[old])
    emit("current issuer keys after rotation", nodes=[signed(origin)])
    emit("apply opaque schema query", verb="apply", dp=[["not-a-qualified-said", "/", []]])
    emit("opaque schema query cannot satisfy Grant", nodes=[signed(origin)], dp=[["not-a-qualified-said", "/", []]])

assert cases[0]["outcome"] == "accept"
assert any(row["outcome"] == "reject" for row in cases)
modules = verify_source()
pathlib.Path(sys.argv[1]).write_text(json.dumps(dict(reference=REFERENCE, modules=modules, wires=wires, cases=cases), indent=2) + "\n")
