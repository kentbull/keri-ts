"""Read a query recipient's accepted KEL state using the selected reference's own Habery."""
import argparse
import json

from keri import kering
from keri.app.habbing import Habery


def main():
    """Reopen a completed CLI invocation's store; never seed or repair protocol evidence."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", required=True)
    parser.add_argument("--prefix", required=True)
    parser.add_argument("--legacy", action="store_true")
    args = parser.parse_args()
    version = {} if args.legacy else dict(version=kering.Vrsn_1_0)
    hby = Habery(name=args.name, **version)
    try:
        kever = hby.kevers[args.prefix]
        print(json.dumps(dict(sn=kever.sn, said=kever.serder.said)))
    finally:
        hby.close()


if __name__ == "__main__":
    main()
