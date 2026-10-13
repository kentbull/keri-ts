"""Cross-check accepted EXN proof rows using the unmodified frozen upstream processor."""
import json
import pathlib
import runpy
import subprocess
import sys

from keri.app import habbing
from keri.core import parsing
from keri.kering import Vrsn_1_0, Vrsn_2_0
from keri.peer import exchanging

reference = runpy.run_path(str(pathlib.Path(__file__).parents[2] / "cesr/scripts/reference-nested-vectors.py"))
reference["verify_source"]()
root = pathlib.Path(parsing.__file__).resolve().parents[3]
for name, module in list(sys.modules.items()):
    if name.startswith("keri.") and getattr(module, "__file__", None):
        path = pathlib.Path(module.__file__).resolve()
        if path.suffix == ".py":
            assert path.read_bytes() == subprocess.check_output(
                ["git", "-C", str(root), "show", f'{reference["REFERENCE"]}:{path.relative_to(root)}']), str(path)


class ProofRoute:
    """Exercise the existing evidence-selection seam without claiming IPEX workflow coverage."""
    resource = "/proof"
    acceptsSscs = True
    acceptsEvidence = False

    def __init__(self):
        self.verified = 0
        self.handled = 0
        self.has_sender_seal = False

    def verifyEvidence(self, serder, tsgs, cigars, sourceSeals, invalid):
        """Retain only factors independently authenticated by the reference kernel."""
        return None if invalid else (tsgs, cigars, sourceSeals)

    def verify(self, serder, **kwa):
        """This probe qualifies exchange proofs; route-specific credential validation comes later."""
        self.verified += 1
        assert ("evidence" in kwa) == self.acceptsEvidence
        assert ("sscs" in kwa) == (self.acceptsSscs and self.has_sender_seal)
        return True

    def handle(self, serder, **kwa):
        """Durable rows, not a synthetic handler success, supply the assertions below."""
        self.handled += 1
        assert "evidence" not in kwa
        assert ("sscs" in kwa) == (self.acceptsSscs and self.has_sender_seal)


corpus = json.load(sys.stdin)
returned = []
with habbing.openHby(name="ts-exchange-proofs", temp=True) as hby:
    for wire in corpus["bootstrap"]:
        stream = bytearray(wire)
        parsing.Parser(version=Vrsn_1_0).parse(ims=stream, kvy=hby.kvy, local=True)
        assert not stream
    hby.kvy.kramer = None  # Qualify the reference-supported optional-KRAM-disabled intake.
    route = ProofRoute()
    exc = exchanging.Exchanger(hby=hby, handlers=[route])
    for row in corpus["rows"]:
        route.has_sender_seal = bool(row["seals"] and not row["endorsers"])
        stream = bytearray(row["wire"])
        parsing.Parser(version=Vrsn_1_0).parse(ims=stream, kvy=hby.kvy, exc=exc)
        assert not stream
        serder = hby.db.exns.get(keys=(row["said"],))
        assert serder is not None, (row["said"], row["signers"], row["cigars"], row["seals"])
        tsgs, cigars = exchanging.verify(hby, serder)
        assert sorted(prefixer.qb64 for prefixer, *_ in tsgs) == sorted(row["signers"])
        assert sorted(cigar.verfer.qb64 for cigar in cigars) == sorted(row["cigars"])
        seals = sorted((keys[1], number.sn, diger.qb64)
                       for keys, (number, diger) in hby.db.ests.getTopItemIter(keys=(row["said"], "")))
        assert seals == sorted(tuple(seal) for seal in row["seals"])
        for endorser in row["endorsers"]:
            assert row["said"] in [d.qb64 for d in hby.db.eidx.get(keys=(endorser,))]
        returned.append(dict(said=row["said"], wire=list(exchanging.serializeMessage(hby, row["said"], framed=True))))
    # Independently exercise capability delivery on already verified wire. This
    # generic route is proof machinery only, not an IPEX workflow implementation.
    plain = next(row for row in corpus["rows"] if row["cigars"] and not row["endorsers"])
    for select, deliver in [(False, False), (True, False), (False, True), (True, True)]:
        policy = ProofRoute()
        policy.acceptsEvidence = deliver
        if not select:
            policy.verifyEvidence = None
        probe = exchanging.Exchanger(hby=hby, handlers=[policy])
        parsing.Parser(version=Vrsn_1_0).parse(ims=bytearray(plain["wire"]), kvy=hby.kvy, exc=probe)
        assert (policy.verified, policy.handled) == (1, 1)
    sealed = next(row for row in corpus["rows"] if row["seals"] and not row["endorsers"])
    for receive in (False, True):
        policy = ProofRoute()
        policy.acceptsSscs = receive
        policy.has_sender_seal = True
        probe = exchanging.Exchanger(hby=hby, handlers=[policy])
        parsing.Parser(version=Vrsn_1_0).parse(ims=bytearray(sealed["wire"]), kvy=hby.kvy, exc=probe)
        assert (policy.verified, policy.handled) == (1, 1)
json.dump(returned, sys.stdout)
