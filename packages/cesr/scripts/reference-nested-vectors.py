"""Generate signed nested-message literals with verified frozen KERIpy source.

Run with PYTHONPATH pointing at the frozen checkout. This opens no database and
records the actual msgParsator tree, including signatures and fully consumed wire.
"""
import base64
import json
import pathlib
import subprocess
import sys

from keri import kering
from keri.core import coring, counting, eventing, parsing, serdering, signing

# Pin behavioral fixtures independently of the runtime harness.
REFERENCE = "7143832813cac6a394ab1faf9be83bb3372be87c"


def verify_source():
    """Reject any imported implementation differing from the committed reference."""
    root = pathlib.Path(coring.__file__).resolve().parents[3]
    assert subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() == REFERENCE
    for module in [kering, coring, counting, eventing, parsing, serdering, signing]:
        path = pathlib.Path(module.__file__).resolve()
        assert path.read_bytes() == subprocess.check_output(
            ["git", "-C", str(root), "show", f"{REFERENCE}:{path.relative_to(root)}"]), str(path)
    print(f"reference={REFERENCE} python={sys.version.split()[0]} root={root}", file=sys.stderr)


def parse(wire):
    """Use the reference's actual nested extractor, requiring complete consumption."""
    stream = bytearray(wire)
    operation = parsing.Parser(version=kering.Vrsn_2_0).msgParsator(ims=stream)
    try:
        next(operation)
    except StopIteration as done:
        assert not stream
        return done.value
    raise AssertionError("Complete input unexpectedly suspended")


def summary(frame):
    """Record semantic ownership independently of the TypeScript implementation."""
    return dict(sad=frame.serder.sad, sigers=[sig.qb64 for sig in frame.sigers],
                nests=[summary(nest) for nest in frame.nests])


def generate():
    """Cover native xip, protocol 1/2 non-native bodies, and descendant ownership."""
    signer = signing.Signer(raw=bytes(range(32)), code="A")
    version = kering.Vrsn_2_0
    codes = counting.Codens

    def signed(kind, major, index, nests=None, nested=True):
        """Sign a distinct body so signature reassignment is observable."""
        if kind == kering.Kinds.cesr:
            sad = dict(serdering.SerderKERI.Fields["KERI"][version]["xip"].alls)
            sad.update(u="1AAP", i=signer.verfer.qb64, ri=signer.verfer.qb64, dt="2026-10-13T01:02:03.000004+00:00", r="nest", a={"n": str(index)})
            event = serdering.SerderKERI(sad=sad, makify=True, pvrsn=version, kind=kind, ilk="xip")
        else:
            event = eventing.incept(keys=[signer.verfer.qb64], version=kering.Versionage(major, 0),
                                   kind=kind, data=[{"d": coring.Diger(raw=bytes([index]) * 32).qb64}])
        return eventing.messagize(event, sigers=[signer.sign(ser=event.raw, index=0)], nests=nests,
                                 nested=nested, framed=False, gvrsn=version)

    rows = []
    for kind, major in [(kering.Kinds.cesr, 2), (kering.Kinds.json, 1), (kering.Kinds.json, 2),
                        (kering.Kinds.cbor, 1), (kering.Kinds.cbor, 2),
                        (kering.Kinds.mgpk, 1), (kering.Kinds.mgpk, 2)]:
        children = [signed(kind, major, index) for index in (1, 2)]
        wire = signed(kind, major, 0, children)
        rows.append(dict(name=f"{kind}-v{major}", qb64=wire.decode(), tree=summary(parse(wire))))
    grandchild = signed(kering.Kinds.cesr, 2, 3)
    deep = signed(kering.Kinds.cesr, 2, 0, [signed(kering.Kinds.cesr, 2, 1, [grandchild]), signed(kering.Kinds.cesr, 2, 2)])
    rows.append(dict(name="deep", qb64=deep.decode(), tree=summary(parse(deep))))
    # A native child can close itself with AttachmentGroup instead of BodyWithAttachmentGroup.
    closed = signed(kering.Kinds.cesr, 2, 0, [signed(kering.Kinds.cesr, 2, 1, nested=False)])
    rows.append(dict(name="child-attachment-group", qb64=closed.decode(), tree=summary(parse(closed))))
    # The parent may likewise use a bare body followed by its explicit attachment enclosure.
    enclosed = signed(kering.Kinds.cesr, 2, 0, [signed(kering.Kinds.cesr, 2, 1)], nested=False)
    rows.append(dict(name="parent-attachment-group", qb64=enclosed.decode(), tree=summary(parse(enclosed))))
    # Nested selectors belong to a child enclosure and must not change its next sibling.
    v1 = kering.Vrsn_1_0
    event = eventing.incept(keys=[signer.verfer.qb64], version=v1, kind=kering.Kinds.json)
    body = counting.Counter.enclose(qb64=coring.Texter(raw=event.raw).qb64b,
                                    code=codes.NonNativeBodyGroup, version=v1)
    sig = counting.Counter(code=codes.ControllerIdxSigs, count=1, version=v1).qb64b + signer.sign(ser=event.raw, index=0).qb64b
    legacy = counting.Counter.enclose(qb64=body + sig, code=codes.BodyWithAttachmentGroup, version=v1)
    selected = counting.Counter.enclose(qb64=counting.Counter.makeGVC(version=v1) + body + sig,
                                        code=codes.BodyWithAttachmentGroup, version=version)
    mixed = signed(kering.Kinds.cesr, 2, 0, [selected, signed(kering.Kinds.cesr, 2, 2)])
    rows.append(dict(name="child-genus-selector", qb64=mixed.decode(), tree=summary(parse(mixed))))
    old = counting.Counter.makeGVC(version=v1) + counting.Counter.enclose(
        qb64=body + sig + legacy + legacy, code=codes.BodyWithAttachmentGroup, version=v1)
    rows.append(dict(name="genus1-tree", qb64=old.decode(), tree=summary(parse(old))))
    # GenericGroup is not an attachment-context message; record the reference failure.
    child = signed(kering.Kinds.cesr, 2, 1)
    generic = counting.Counter.enclose(qb64=child, code=codes.GenericGroup)
    invalid = signed(kering.Kinds.cesr, 2, 0, [generic])
    try:
        parse(invalid)
    except Exception as error:
        rejection = dict(qb64=invalid.decode(), error=type(error).__name__)
    else:
        raise AssertionError("Reference admitted GenericGroup in attachments")
    for row in rows:
        binary = base64.urlsafe_b64decode(row["qb64"])
        assert summary(parse(binary)) == row["tree"]
        row["qb2"] = binary.hex()
    return dict(reference=REFERENCE, signer=signer.verfer.qb64, rows=rows, invalidGeneric=rejection)


if __name__ == "__main__":
    verify_source()
    json.dump(generate(), sys.stdout, indent=2)
    print()
