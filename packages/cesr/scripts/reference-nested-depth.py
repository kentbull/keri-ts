"""Freeze a signed tree whose admitted enclosure depth must survive serialization."""
import base64
import json
import pathlib
import runpy

from keri import kering
from keri.core import eventing


def generate():
    """Use the pinned serializer and extractor to qualify forty repeated signed nodes."""
    reference = runpy.run_path(str(pathlib.Path(__file__).with_name("reference-nested-vectors.py")))
    reference["verify_source"]()
    vectors = reference["generate"]()
    frame = reference["parse"](vectors["rows"][0]["qb64"].encode())
    wire = None
    # Each native child has one body-with-attachments boundary, not an extra attachment wrapper.
    for _ in range(40):
        wire = eventing.messagize(frame.serder, sigers=frame.sigers,
                                 nests=[wire] if wire is not None else None,
                                 nested=True, gvrsn=kering.Vrsn_2_0)
    parsed = reference["parse"](wire)
    depth = 0
    while True:
        assert parsed.serder.raw == frame.serder.raw
        assert [siger.qb64 for siger in parsed.sigers] == [frame.sigers[0].qb64]
        depth += 1
        if not parsed.nests:
            break
        assert len(parsed.nests) == 1
        parsed = parsed.nests[0]
    assert depth == 40
    return dict(reference=reference["REFERENCE"], depth=depth, body=frame.serder.raw.hex(), sad=frame.serder.sad,
                signature=frame.sigers[0].qb64, qb64=wire.decode(),
                qb2=base64.urlsafe_b64decode(wire).hex())


if __name__ == "__main__":
    print(json.dumps(generate(), indent=2))
