"""Create/reopen a real KERIpy Baser and capture its exact persistent rows."""
import argparse
import json

import lmdb
# Legacy KERIpy's own basing tests initialize eventing before the mutually
# importing basing module. Preserve that reference startup order.
from keri.core import eventing
from keri.db import basing


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("create", "verify"))
    parser.add_argument("head")
    parser.add_argument("name")
    parser.add_argument("selected")
    parser.add_argument("retained")
    args = parser.parse_args()
    db = basing.Baser(name=args.name, headDirPath=args.head,
                      temp=False, reopen=True, readonly=args.action == "verify")
    try:
        for table in (db.oobis, db.woobi, db.coobi, db.roobi):
            if args.action == "create":
                for key in (args.selected, args.retained):
                    assert table.pin(keys=key, val=basing.OobiRecord(
                        date="2026-10-20T00:00:00.000000+00:00"))
            else:
                assert table.get(keys=args.retained) is not None
                if table is db.oobis:
                    assert table.get(keys=args.selected) is None
                else:
                    assert table.get(keys=args.selected) is not None
        path = db.path
    finally:
        db.close()

    # Use a separate owner after Baser closes. Opening a live V1 environment
    # twice in one process can invalidate LMDB reader slots.
    env = lmdb.open(path, readonly=True, create=False, max_dbs=256)
    try:
        with env.begin() as txn:
            root = list(txn.cursor())
        tables = {}
        metadata = {}
        for key, value in root:
            if key.endswith(b"."):
                table = env.open_db(key, create=False)
                with env.begin(db=table) as txn:
                    tables[key.decode()] = [(k.hex(), v.hex()) for k, v in txn.cursor()]
            else:
                metadata[key.hex()] = value.hex()
        print(json.dumps({"path": path, "metadata": metadata, "tables": tables}))
    finally:
        env.close()


if __name__ == "__main__":
    main()
