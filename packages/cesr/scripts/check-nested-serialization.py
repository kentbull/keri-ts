"""Accept TS-emitted trees only after verifying imported frozen Python source bytes.

Called by qualify-nested-serialization.ts with a finite JSON corpus on stdin.
This proves structural acceptance and signature ownership, not runtime authorization.
"""
import json
import pathlib
import runpy
import subprocess
import sys

from keri.core import coring
from keri.peer import exchanging

reference = runpy.run_path(str(pathlib.Path(__file__).with_name("reference-nested-vectors.py")))
reference["verify_source"]()
root = pathlib.Path(coring.__file__).resolve().parents[3]
# Verify every loaded KERI module, including the serializer and its semantic dependencies.
for name, module in list(sys.modules.items()):
    if not name.startswith("keri.") or not getattr(module, "__file__", None):
        continue
    path = pathlib.Path(module.__file__).resolve()
    if path.suffix == ".py":
        assert path.read_bytes() == subprocess.check_output(
            ["git", "-C", str(root), "show", f'{reference["REFERENCE"]}:{path.relative_to(root)}']), str(path)

corpus = json.load(sys.stdin)
verfer = coring.Verfer(qb64=corpus["signer"])


def verify_signatures(frame):
    """Reject any accidental reassignment of parent or child signatures."""
    for signature in frame.sigers:
        assert verfer.verify(signature.raw, frame.serder.raw)
    for nest in frame.nests:
        verify_signatures(nest)


for row in corpus["rows"]:
    parsed = reference["parse"](bytes.fromhex(row["hex"]))
    assert reference["summary"](parsed) == row["tree"], row["name"]
    verify_signatures(parsed)
    if "essr" in row:
        assert b"".join(texter.raw for texter in parsed.nests[0].essrs).hex() == row["essr"]
    # Exercise the reference's actual subtree serializer as the durable exchange seam.
    reparsed = reference["parse"](exchanging.serializeParsedSubstream(parsed))
    assert reference["summary"](reparsed) == row["tree"], row["name"]
print(f'Accepted {len(corpus["rows"])} TS nested outputs and Python subtree reserializations at {reference["REFERENCE"]}')
