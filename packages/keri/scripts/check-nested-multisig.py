"""Check real TS exchange rows with frozen upstream parsing, signatures, multisig handlers and storage."""
import json
import pathlib
import runpy
import subprocess
import sys

from keri.app import grouping, habbing, notifying
from keri.core import eventing, parsing, serdering, signing
from keri.peer import exchanging
from keri.kering import DeserializeError, Kinds, Vrsn_1_0, Vrsn_2_0

reference = runpy.run_path(str(pathlib.Path(__file__).parents[2] / "cesr/scripts/reference-nested-vectors.py"))
reference["verify_source"]()
root = pathlib.Path(parsing.__file__).resolve().parents[3]
for name, module in list(sys.modules.items()):
    if name.startswith("keri.") and getattr(module, "__file__", None):
        path = pathlib.Path(module.__file__).resolve()
        if path.suffix == ".py":
            assert path.read_bytes() == subprocess.check_output(
                ["git", "-C", str(root), "show", f'{reference["REFERENCE"]}:{path.relative_to(root)}']), str(path)

# The default native EXN builder omits ri/x/p wire values despite reporting local verify success.
# Preserve the parser failure as an explicit unqualified reference defect, never a passing format case.
signer = signing.Signer(raw=bytes(range(32)))
native = eventing.exchange(sender=signer.verfer.qb64, route="/multisig/icp", attributes={}, kind=Kinds.cesr)
try:
    serdering.SerderKERI(raw=native.raw)
except DeserializeError:
    print("reference native default EXN cannot be decoded; excluded from qualified formats", file=sys.stderr)
else:
    raise AssertionError("Native reference boundary changed; requalify instead of silently skipping")

corpus = json.load(sys.stdin)
returned = []
with habbing.openHby(name="ts-multisig-qualification", temp=True) as hby:
    for wire in corpus["bootstrap"]:
        stream = bytearray(wire)
        parsing.Parser(version=Vrsn_1_0).parse(ims=stream, kvy=hby.kvy, local=True)
        assert not stream
    # Membership is the explicit app configuration for this public-wire probe. No local signature is invented.
    # Independent TS tests use separate real participant stores for approval and child acceptance.
    hby.habs[corpus["local"]] = None
    mux = grouping.Multiplexor(hby=hby, notifier=notifying.Notifier(hby=hby))
    exc = exchanging.Exchanger(hby=hby, handlers=[])
    grouping.loadHandlers(exc=exc, mux=mux)
    for row in corpus["rows"]:
        stream = bytearray(row["wire"])
        parsing.Parser(version=Vrsn_2_0).parse(ims=stream, exc=exc)
        assert not stream
        accepted = hby.db.exns.get(keys=(row["said"],))
        assert accepted is not None, row["said"]
        stored = hby.db.enst.get(keys=(row["said"],))
        assert len(stored) == 1
        child = reference["parse"](stored[0].encode())
        assert child.serder.said == row["child"]
        original = reference["parse"](row["stored"][0].encode())
        assert child.serder.raw == original.serder.raw
        assert [sig.qb64 for sig in child.sigers] == [sig.qb64 for sig in original.sigers]
        assert [saider.qb64 for saider in hby.db.meids.get(keys=(row["child"],))].count(row["said"]) == 1
        returned.append(dict(said=child.serder.said, wire=list(exchanging.serializeParsedSubstream(child))))
json.dump(returned, sys.stdout)
