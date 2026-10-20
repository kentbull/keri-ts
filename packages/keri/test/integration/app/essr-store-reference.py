"""Read TS evidence and write ordinary ESSR rows with the pinned KERIpy store."""
import argparse
import json

from keri.core import coring
from keri.db import dbing, subing


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("head")
    parser.add_argument("name")
    parser.add_argument("accepted")
    parser.add_argument("pending")
    args = parser.parse_args()
    db = dbing.LMDBer(name=args.name, headDirPath=args.head, temp=False,
                     reopen=True)
    try:
        # This is Baser.essrs' actual type, table name and codec in every pin.
        essrs = subing.CesrIoSetSuber(db=db, subkey="essrs.", klas=coring.Texter)
        fragments = essrs.get(keys=(args.accepted,))
        assert [bytes(part.raw) for part in fragments] == [b"abc", b"abc"]
        with db.env.begin(db=essrs.sdb) as txn:
            rows = [(bytes(key), bytes(value)) for key, value in txn.cursor()
                    if bytes(key).startswith(args.accepted.encode() + b".")]
        assert rows == [(dbing.suffix(args.accepted, ordinal), part.qb64b)
                        for ordinal, part in enumerate(fragments)]
        assert essrs.rem(keys=(args.pending,))
        assert essrs.put(keys=(args.pending,), vals=[coring.Texter(raw=raw)
                                                   for raw in (b"xyz", b"uvw")])
        print(json.dumps({"read": [bytes(part.raw).decode() for part in fragments],
                          "written": [bytes(part.raw).decode()
                                      for part in essrs.get(keys=(args.pending,))]}))
    finally:
        db.close()


if __name__ == "__main__":
    main()
