"""Public IPEX graph admission observations from the current v2-spec owner.

Run with the pinned repository on PYTHONPATH and Docker-owned temporary state.
No section preparation or received-byte rewriting: these are ordinary acdcmap
constructor outputs after the reference's section-commitment repair.
"""
import hashlib
import json
import pathlib
import subprocess
import sys
from collections import deque
from keri import Kinds, Vrsn_2_0
from keri.app import openHby
from keri.core import Diger, Noncer, Number, Parser, Salter, Schemer, exchept, messagize
from keri.acdc import acdcmap, ipexing
from keri.peer import Exchanger

REFERENCE = "c5841f30d0d830bad62e0ab91e66d98a0afac20c"
root = pathlib.Path(ipexing.__file__).resolve().parents[3]


def verify_source():
    """Bind every imported Python module to the exact reference bytes."""
    modules = {}
    for name, module in list(sys.modules.items()):
        if (name == "keri" or name.startswith("keri.")) and getattr(module, "__file__", None):
            path = pathlib.Path(module.__file__).resolve()
            if path.suffix == ".py":
                raw = path.read_bytes()
                assert raw == subprocess.check_output(["git", "-c", f"safe.directory={root}", "-C", str(root), "show", f"{REFERENCE}:{path.relative_to(root)}"]), str(path)
                modules[str(path.relative_to(root))] = hashlib.sha256(raw).hexdigest()
    return dict(sorted(modules.items()))


verify_source()
wires, cases, schemas, cached = [], [], {}, []
salt = Salter(raw=b"0123456789abcdef").qb64
stamp = "2026-10-13T01:00:00.000000+00:00"
with (openHby(name="graph-source", temp=True, salt=salt) as source,
      openHby(name="graph-receiver", temp=True, salt=salt) as receiver):
    issuer = source.makeHab(name="issuer")
    holder = source.makeHab(name="holder")
    pending = source.makeHab(name="pending")
    recipient = receiver.makeHab(name="recipient")
    for hab in (issuer, holder):
        wire = bytes(hab.msgOwnEvent(sn=0)).decode()
        wires.append(wire)
        Parser().parse(ims=bytearray(wire.encode()), kvy=receiver.kvy)
    wires.append(bytes(recipient.msgOwnEvent(sn=0)).decode())
    exc = Exchanger(hby=receiver, handlers=[])
    ipexing.loadHandlers(hby=receiver, exc=exc, notifier=None)

    def node(role, *, hab=issuer, issuee=issuer.pre, edge=None, schema=None):
        return acdcmap(israid=hab.pre, iseaid=issuee,
                       attribute=dict(d="", role=role), edge=edge, schema=schema)

    def signed(body, hab=issuer, data=None):
        return messagize(serder=body, tsgs=[(hab.kever.prefixer, Number(sn=hab.kever.lastEst.s),
                         Diger(qb64=hab.kever.lastEst.d), hab.sign(ser=body.raw if data is None else data, indexed=True))],
                         framed=False, gvrsn=Vrsn_2_0)

    def leaf(body, op=None, pin=None, **extra):
        value = dict(d="", n=body.said)
        if pin is not None:
            value["s"] = pin
        if op is not None:
            value["o"] = op
        value.update(extra)
        return value

    def group(op="AND", **members):
        return dict(d="", o=op, **members)

    graph_schema = Schemer(sed={"$id": "", "version": "1.0.0", "type": "object"})
    good, other = node("good"), node("other", issuee=holder.pre)
    waiting = node("pending", hab=pending)
    untargeted = node("untargeted", issuee=None)

    def emit(name, edges, expected, *, far=None, proofs=None, root_hab=issuer, root_schema=None, cache=(), anchor=False):
        """Observe the real parser/Exchanger result, with all public topology intact."""
        origin = node(name, hab=root_hab, issuee=holder.pre, edge=edges, schema=root_schema or graph_schema.sed)
        bodies = {body.said: body for body in (far or [good, other, waiting, untargeted])}
        bodies[origin.said] = origin
        plan, ordered, seen = [], [], set()
        queue = deque([(origin.said, "/")])
        while queue:
            said, path = queue.popleft()
            if said in seen:
                continue
            seen.add(said)
            body = bodies[said]
            plan.append([body.schema if isinstance(body.schema, str) else body.schema["$id"], path, []])
            ordered.append(body)
            edge = body.sad.get("e")
            blocks = edge if isinstance(edge, list) else [edge] if edge else []
            groups = deque((block, f"/e/{index}/" if isinstance(edge, list) else "/e/") for index, block in enumerate(blocks))
            while groups:
                value, prefix = groups.popleft()
                if not isinstance(value, dict):
                    continue
                if "n" in value:
                    if value["n"] in bodies:
                        queue.append((value["n"], prefix + "_/"))
                    continue
                for label, child in value.items():
                    if label not in ("d", "u", "s", "o", "w") and isinstance(child, dict):
                        groups.append((child, prefix + label + "/"))
        arguments = dict(sender=holder.pre, receiver=recipient.pre, route="/ipex/grant",
                         attributes=dict(m=name, o=[origin.said]), modifiers=dict(dp=[plan], ax=[anchor]),
                         stamp=stamp, pvrsn=Vrsn_2_0, gvrsn=Vrsn_2_0, kind=Kinds.json)
        body = exchept(nonce=Noncer(raw=Diger(ser=name.encode()).raw[:16]).qb64, **arguments)
        streams = []
        for credential in ordered:
            if credential.said == origin.said:
                streams.append(signed(credential, root_hab))
            elif proofs and credential.said in proofs:
                streams.append(proofs[credential.said])
            else:
                streams.append(signed(credential, pending if credential.said == waiting.said else issuer))
        for schema in cache:
            schemas[schema.said] = schema.sed
            if schema.said not in cached:
                cached.append(schema.said)
            receiver.db.schema.pin(keys=(schema.said,), val=schema)
        wire = ipexing._sign(holder, body, nests=[ipexing._normalizeNodeStream(stream) for stream in streams])
        Parser().parse(ims=bytearray(wire), framed=False, exc=exc)
        outcome = ("accept" if receiver.db.exns.get(keys=(body.said,)) else
                   "escrow" if receiver.db.epse.get(keys=(body.said,)) or any(receiver.db.emse.getTopItemIter(keys=(body.said,))) else "reject")
        assert outcome == expected, (name, outcome, expected)
        cases.append(dict(name=name, through=len(wires), cache=list(cached),
                          said=body.said, wire=bytes(wire).decode(), outcome=outcome))

    emit("default NI2I untargeted", group(link=leaf(untargeted)), "accept")
    emit("default I2I", group(link=leaf(good)), "accept")
    emit("default I2I mismatch", group(link=leaf(other)), "reject")
    emit("explicit NI2I", group(link=leaf(other, "NI2I")), "accept")
    emit("E1E mismatch", group(link=leaf(good, "E1E")), "reject")
    emit("E1E targeted match", group(link=leaf(other, "E1E")), "accept")
    emit("last delegative wins", group(link=leaf(other, ["I2I", "NI2I"])), "accept")
    emit("last delegative fails", group(link=leaf(other, ["NI2I", "I2I"])), "reject")
    emit("E1E composes with delegative", group(link=leaf(other, ["E1E", "I2I"])), "reject")
    emit("direct top-level leaf", leaf(good), "reject")
    emit("edge block list", [group(link=leaf(good))], "reject")
    for operator in ("OR", "AND"):
        emit(f"{operator} mismatched relation", group(operator, good=leaf(good), bad=leaf(other)), "accept" if operator == "OR" else "reject")
        emit(f"{operator} pending issuer", group(operator, good=leaf(good), pending=leaf(waiting)), "accept" if operator == "OR" else "escrow")
        emit(f"{operator} refused issuer", group(operator, good=leaf(good), bad=leaf(other, "NI2I")),
             "accept" if operator == "OR" else "reject", proofs={other.said: signed(other, data=b"forged")})
        for token in ("DI2I", "NOT", "BOGUS"):
            emit(f"{operator} unsupported {token}", group(operator, good=leaf(good), unknown=leaf(other, token)), "accept" if operator == "OR" else "reject")
        emit(f"{operator} unsupported group", group(operator, good=leaf(good), unknown=group("NOR", child=leaf(other))), "accept" if operator == "OR" else "reject")
        emit(f"{operator} compact Edge reference", group(operator, good=leaf(good), compact=other.said), "accept" if operator == "OR" else "reject")
    emit("AND permanent and retryable unknown", group("AND", absent=leaf(waiting), permanent=leaf(other, "DI2I")), "reject")
    emit("OR permanent and retryable unknown", group("OR", absent=leaf(waiting), permanent=leaf(other, "DI2I")), "escrow")
    emit("root authentication cannot be outvoted", group("OR", good=leaf(good, "NI2I")), "escrow", root_hab=pending)
    emit("OR malformed group operator", group("OR", good=leaf(good), broken=group(["AND"], child=leaf(other))), "reject")
    emit("OR malformed scalar member", group("OR", good=leaf(good), broken=42), "reject")
    emit("OR empty group", group("OR", good=leaf(good), broken=group()), "reject")
    emit("OR unknown leaf label", group("OR", good=leaf(good), broken=leaf(other, "BOGUS", unexpected=True)), "reject")
    emit("unsupported group cannot hide malformed", group("OR", good=leaf(good), hidden=group("NOR", broken=42)), "reject")
    malformed = node("malformed subtree", edge=group(broken=group(["AND"], child=leaf(other))))
    emit("unsupported unary cannot hide malformed far subtree", group("OR", good=leaf(good), hidden=leaf(malformed, "BOGUS")), "reject", far=[good, malformed, other])
    pin = Schemer(sed={"$id": "", "version": "1.0.0", "type": "object", "properties": {"a": {"properties": {"role": {"const": "good"}}}}})
    wrong = Schemer(sed={"$id": "", "version": "1.0.0", "type": "object", "properties": {"a": {"properties": {"role": {"const": "different"}}}}})
    emit("OR unused missing pin", group("OR", good=leaf(good), unread=leaf(other, "NI2I", pin.said)), "accept")
    emit("AND missing pin", group("AND", good=leaf(good), unread=leaf(other, "NI2I", pin.said)), "escrow")
    emit("OR malformed pin cannot be outvoted", group("OR", good=leaf(good), broken=leaf(other, "BOGUS", 42)), "reject")
    emit("OR malformed inline schema cannot be outvoted", group("OR", good=leaf(good), broken=leaf(other, "BOGUS", {"$id": "wrong"})), "reject")
    emit("cached pin mismatch", group(link=leaf(other, "NI2I", pin.said)), "reject", cache=[pin])
    emit("top-level schema pin", dict(d="", s=pin.said, link=leaf(good)), "accept", cache=[pin])
    emit("top-level pin is not dropped", dict(d="", s=wrong.said, link=leaf(good)), "reject", cache=[wrong])
    emit("nested pins conjoin", dict(d="", s=wrong.said, nested=dict(d="", s=pin.said, link=leaf(good, pin=pin.said))), "reject", cache=[wrong])
    emit("minimal inline schema pin", group(link=leaf(good, pin=pin.sed)), "accept")
    emit("minimal inline schema pin mismatch", group(link=leaf(other, "NI2I", pin.sed)), "reject")
    emit("inline inherited pins conjoin", dict(d="", s=wrong.sed, nested=dict(d="", s=pin.sed, link=leaf(good, pin=pin.sed))), "reject")
    emit("same inline own-schema pin", group(link=leaf(good, pin=good.schema["$id"])), "accept")
    invalid = node("invalid own schema", schema=wrong.sed)
    emit("OR cannot hide invalid far own schema", group("OR", good=leaf(good), invalid=leaf(invalid)), "reject", far=[good, invalid])
    emit("own schema validation precedes pending root auth", group(link=leaf(good)), "reject", root_hab=pending, root_schema=wrong.sed)
    emit("ax failure precedes pending root auth", group(link=leaf(good)), "reject", root_hab=pending, anchor=True)

modules = verify_source()
pathlib.Path(sys.argv[1]).write_text(json.dumps(dict(reference=REFERENCE, modules=modules, schemas=schemas, wires=wires, cases=cases), indent=2) + "\n")
