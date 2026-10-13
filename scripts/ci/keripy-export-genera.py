"""Clone the fixture's stored KEL with each explicit attachment genus.

This is a wire reference, not a replacement for the actual CLI export call:
the test independently compares that CLI output with the genus-2 clone.
"""

import argparse
import json

from keri.app.habbing import Habery
from keri.kering import Vrsn_1_0, Vrsn_2_0


def main():
    """Reopen the isolated CLI store and emit the same evidence in both genera."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", required=True)
    parser.add_argument("--base", required=True)
    parser.add_argument("--passcode", required=True)
    parser.add_argument("--alias", required=True)
    args = parser.parse_args()
    hby = Habery(name=args.name, base=args.base, bran=args.passcode, version=Vrsn_1_0)
    try:
        hab = hby.habByName(args.alias)
        streams = {
            str(version.major): b"".join(hby.db.clonePreIter(hab.pre, gvrsn=version)).decode()
            for version in (Vrsn_1_0, Vrsn_2_0)
        }
        print(json.dumps(streams))
    finally:
        hby.close()


if __name__ == "__main__":
    main()
