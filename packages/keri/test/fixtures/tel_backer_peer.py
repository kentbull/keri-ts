"""Observe public backed TEL wire with unmodified pinned-main Kevery and Tevery."""
import json
import sys
from pathlib import Path

from keri import Vrsn_1_0
from keri.app import openHby
from keri.core import Kevery, Parser
from keri.vdr.eventing import Tevery, openReger


def verify(evidence):
    """Accept the issuer KEL independently, then the receipt-complete registry inception."""
    with openHby(name="backer-observer", temp=True, version=Vrsn_1_0) as hby:
        with openReger(name="backer-observer", temp=True) as reger:
            kvy = Kevery(db=hby.db, lax=True, local=False)
            tvy = Tevery(db=hby.db, reger=reger, lax=True, local=False)
            parser = Parser(version=Vrsn_1_0, kvy=kvy, tvy=tvy)
            parser.parse(ims=bytearray(evidence["kel"].encode()))
            parser.parse(ims=bytearray(evidence["tel"].encode()))
            state = tvy.tevers[evidence["registry"]]
            assert state.sn == 0 and state.toad == 2
            assert state.baks == evidence["backers"]
            assert state.serder.said == evidence["registry"]
            return dict(registry=state.serder.said, threshold=state.toad, backers=state.baks)


if __name__ == "__main__":
    print(json.dumps(verify(json.loads(Path(sys.argv[1]).read_text()))))
