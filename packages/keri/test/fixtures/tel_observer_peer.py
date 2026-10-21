"""Observe legacy indexed TEL evidence with unmodified pinned Python processors."""
import argparse
import json
from pathlib import Path
from keri.app.habbing import openHby
from keri.core.eventing import Kevery
from keri.core.parsing import Parser
from keri.vdr.eventing import Tevery

args = argparse.ArgumentParser()
args.add_argument("evidence")
args.add_argument("--legacy", action="store_true")
args = args.parse_args()
if args.legacy:
    from keri.vdr.viring import openReger
else:
    from keri import Vrsn_1_0
    from keri.vdr.eventing import openReger


def observe(evidence):
    """Verify issuer KEL and receipt-complete VCP through ordinary reference intake."""
    versions = {} if args.legacy else dict(version=Vrsn_1_0)
    with openHby(name="tel-observer", temp=True, **versions) as hby:
        with openReger(name="tel-observer", temp=True) as reger:
            tvy = Tevery(db=hby.db, reger=reger, lax=True, local=False)
            parser = Parser(kvy=Kevery(db=hby.db, lax=True, local=False), tvy=tvy, **versions)
            parser.parse(ims=bytearray(evidence["kel"].encode()))
            parser.parse(ims=bytearray(evidence["tel"].encode()))
            state = tvy.tevers[evidence["registry"]]
            assert state.sn == 0 and state.toad == 2
            assert state.baks == evidence["backers"]
            assert state.serder.said == evidence["registry"]
            return dict(registry=state.serder.said, threshold=state.toad, backers=state.baks)


print(json.dumps(observe(json.loads(Path(args.evidence).read_text()))))
