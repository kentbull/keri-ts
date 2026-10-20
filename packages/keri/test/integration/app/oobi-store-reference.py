"""Create/reopen a real KERIpy Baser and inspect the four OOBI tables."""
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
        tables = {}
        for name in ("oobis.", "woobi.", "coobi.", "roobi."):
            table = env.open_db(name.encode(), create=False)
            with env.begin(db=table) as txn:
                tables[name] = [(k.hex(), v.hex()) for k, v in txn.cursor()]
        print(json.dumps({"path": path, "tables": tables}))
    finally:
        env.close()


if __name__ == "__main__":
    main()
