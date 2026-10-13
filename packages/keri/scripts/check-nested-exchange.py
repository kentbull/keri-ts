"""Check TS-published enst rows and frozen forward/duplicate behavior using real Python tables."""
import json
import pathlib
import runpy
import subprocess
import sys
from types import SimpleNamespace

from keri import kering
from keri.app import forwarding
from keri.core import coring, serdering, signing
from keri.db import basing
from keri.peer import exchanging

reference = runpy.run_path(str(pathlib.Path(__file__).parents[2] / "cesr/scripts/reference-nested-vectors.py"))
reference["verify_source"]()
root = pathlib.Path(coring.__file__).resolve().parents[3]
# Freeze every imported KERI module before exercising semantic or persistence behavior.
for name, module in list(sys.modules.items()):
    if name.startswith("keri.") and getattr(module, "__file__", None):
        path = pathlib.Path(module.__file__).resolve()
        if path.suffix == ".py":
            assert path.read_bytes() == subprocess.check_output(
                ["git", "-C", str(root), "show", f'{reference["REFERENCE"]}:{path.relative_to(root)}']), str(path)

corpus = json.load(sys.stdin)
verfer = coring.Verfer(qb64=corpus["signer"])


def check_tree(frame):
    """Verify each fixture proof against its own body, then descend in stored order."""
    for siger in frame.sigers:
        assert verfer.verify(siger.raw, frame.serder.raw)
    for nest in frame.nests:
        check_tree(nest)


for row in corpus["rows"]:
    parsed = reference["parse"](row["wire"].encode())
    assert reference["summary"](parsed) == row["tree"], row["name"]
    check_tree(parsed)
    assert reference["summary"](reference["parse"](exchanging.serializeParsedSubstream(parsed))) == row["tree"]

# A real nontransferable sender needs no KEL bootstrap; the child remains independently signed.
signer = signing.Signer(raw=bytes(range(32)), transferable=False)
parsed = reference["parse"](corpus["rows"][0]["wire"].encode())
serder = serdering.SerderKERI(sad=dict(t="exn", d="", i=signer.verfer.qb64,
    ri="", x="", p="", dt="2026-10-13T01:02:03.000004+00:00", r="/fwd",
    q={"pre": signer.verfer.qb64, "topic": "nested"}, a={"evt": coring.Diger(ser=parsed.serder.raw).qb64}),
    makify=True, pvrsn=kering.Vrsn_2_0, kind=kering.Kinds.json, ilk="exn")


class Mailbox:
    """Record each real ForwardHandler store call, without transport or network effects."""
    def __init__(self):
        """Start one finite mailbox observation for the duplicate probe."""
        self.messages = []

    def storeMsg(self, topic, msg):
        """Retain the two expected finite child serializations for byte comparison."""
        self.messages.append(bytes(msg))


with basing.openDB(name="nested-exchange-qualification", temp=True) as db:
    hby = SimpleNamespace(db=db)
    mailbox = Mailbox()
    handler = forwarding.ForwardHandler(hby, mailbox)
    exn = exchanging.Exchanger(hby, handlers=[handler])
    cigar = signer.sign(serder.raw)
    assert exn.processEvent(serder, cigars=[cigar], nests=[parsed]) is True
    first = db.enst.get((serder.said,))
    # The parent commitment excludes attachments; a valid replacement changes child proofs only.
    parsed.sigers = []
    assert exn.processEvent(serder, cigars=[cigar], nests=[parsed]) is True
    second = db.enst.get((serder.said,))
    assert first != second and len(second) == 1 and len(mailbox.messages) == 2
    assert not handler.verify(serder, nests=[])
    wrong = reference["parse"](corpus["rows"][1]["wire"].encode())
    assert not handler.verify(serder, nests=[wrong])

print(f'Accepted {len(corpus["rows"])} TS enst rows; verified Python duplicate replacement and handler re-execution at {reference["REFERENCE"]}')
