"""Exercise actual KEL version intake; a valid v1 control distinguishes rejection from a broken peer."""
import argparse
import json
from keri import kering
from keri.app.habbing import openHby
from keri.core.parsing import Parser

args = argparse.ArgumentParser()
args.add_argument('evidence')
args.add_argument('--legacy', action='store_true')
args = args.parse_args()
versions = {} if args.legacy else dict(version=kering.Vrsn_1_0)
with openHby(name='kel-version-observer', temp=True, **versions) as hby:
    observed = {}
    with open(args.evidence) as source:
        evidence = json.load(source)
    for record in evidence:
        context = {} if args.legacy else dict(version=(kering.Vrsn_1_0 if record['major'] == 1 else kering.Vrsn_2_0))
        Parser(kvy=hby.kvy, **context).parse(ims=bytearray(record['wire'].encode()))
        kever = hby.kevers[record['pre']] if record['pre'] in hby.kevers else None
        observed[str(record['major'])] = None if kever is None else dict(sn=kever.sn, said=kever.serder.said)
    print(json.dumps(observed))
