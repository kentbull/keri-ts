"""Qualify pinned-main Baser binding, writer semantics and native ESSR rows."""
import argparse
import json

from keri.core import coring
from keri.db import basing, dbing


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("head")
    parser.add_argument("name")
    parser.add_argument("accepted")
    parser.add_argument("pending")
    parser.add_argument("repeated")
    args = parser.parse_args()
    db = basing.Baser(name=args.name, headDirPath=args.head, temp=False,
                      reopen=True)
    try:
        essrs = db.essrs
        with db.env.begin() as txn:
            assert txn.get(b"essrs.") is not None
        fragments = essrs.get(keys=(args.accepted,))
        assert [bytes(part.raw) for part in fragments] == [b"abc", b"xyz"]
        with db.env.begin(db=essrs.sdb) as txn:
            rows = [(bytes(key), bytes(value)) for key, value in txn.cursor()
                    if bytes(key).startswith(args.accepted.encode() + b".")]
        assert rows == [(dbing.suffix(args.accepted, ordinal), part.qb64b)
                        for ordinal, part in enumerate(fragments)]
        db.close()
        db.reopen()
        essrs = db.essrs
        assert [bytes(part.raw) for part in essrs.get(keys=(args.accepted,))] == [b"abc", b"xyz"]
        assert [bytes(part.raw) for part in essrs.get(keys=(args.repeated,))] == [b"abc"]

        # Each representation verifies on arrival; main appends distinct qualified members.
        alternate = coring.Texter(raw=b"abcxyz", code="4B")
        diger = coring.Diger(qb64=db.exns.get(keys=(args.accepted,)).ked["a"])
        assert diger.verify(ser=alternate.raw)
        redelivery = [essrs.add(keys=(args.accepted,), val=fragments[0]),
                      essrs.add(keys=(args.accepted,), val=alternate),
                      essrs.add(keys=(args.accepted,), val=alternate)]
        assert redelivery == [False, True, False]
        assert not diger.verify(ser=b"".join(part.raw for part in essrs.get(keys=(args.accepted,))))
        assert essrs.rem(keys=(args.pending,))
        writes = [essrs.add(keys=(args.pending,), val=coring.Texter(raw=raw, code="4B"))
                  for raw in (b"xyz", b"uvw", b"xyz")]
        assert writes == [True, True, False]
        print(json.dumps({"read": [bytes(part.raw).decode() for part in fragments],
                          "redelivery": redelivery, "writes": writes,
                          "written": [bytes(part.raw).decode()
                                      for part in essrs.get(keys=(args.pending,))]}))
    finally:
        db.close()


if __name__ == "__main__":
    main()
