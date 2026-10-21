"""Real pinned Python query/signing and observer APIs over a Tufa TCP reply.

This is an API driver, not a KLI credential workflow or autonomous TEL backer.
Legacy imports and main's explicit version selection follow the pinned profiles.
"""
import argparse
import json
import socket
from pathlib import Path

args = argparse.ArgumentParser()
args.add_argument("evidence")
args.add_argument("--legacy", action="store_true")
args = args.parse_args()

from keri.app.habbing import openHby
from keri.core.eventing import Kevery, query as query_event
from keri.core.parsing import Parser
from keri.vdr.eventing import Tevery

if args.legacy:
    from keri.vdr.viring import openReger
else:
    from keri import Vrsn_1_0, Vrsn_2_0
    from keri.core.counting import Counter
    from keri.vdr.eventing import openReger


def observe(evidence, genus):
    """Query a real listener and observe issuance then revocation through normal Tevery intake."""
    versions = dict(version=Vrsn_1_0) if not args.legacy else {}
    with openHby(name="tel-replay", temp=True, **versions) as hby:
        with openReger(name="tel-replay", temp=True) as reger:
            kvy = Kevery(db=hby.db, lax=True, local=False)
            tvy = Tevery(db=hby.db, reger=reger, lax=True, local=False)
            parser = Parser(kvy=kvy, tvy=tvy, **versions)
            parser.parse(ims=bytearray(evidence["kel"].encode()))
            reader = hby.makeHab("reader", transferable=False)
            if args.legacy:
                query = reader.query(pre=evidence["credential"], src=evidence["service"],
                                     route="tels", query=dict(ri=evidence["registry"]))
            else:
                # The main Hab.query convenience couples body/genus selection.
                # Its ordinary builder and signer can express the independent wire contexts.
                body = query_event(pre=reader.pre, route="tels", kind="JSON", pvrsn=Vrsn_1_0,
                                   gvrsn=Vrsn_1_0, query=dict(i=evidence["credential"],
                                   src=evidence["service"], ri=evidence["registry"]))
                query = reader.endorse(body, last=True, gvrsn=Vrsn_1_0 if genus == 1 else Vrsn_2_0)
            if genus == 2:
                query = Counter.makeGVC(Vrsn_2_0) + query
            with socket.create_connection(("127.0.0.1", evidence["port"]), timeout=10) as connection:
                connection.sendall(query)
                connection.shutdown(socket.SHUT_WR)
                received = bytearray()
                while chunk := connection.recv(65536):
                    received.extend(chunk)
            assert received, "TEL query returned no evidence"
            events = []
            while received:
                before = len(received)
                parser.parseOne(ims=received)
                assert len(received) < before, "Reference parser did not consume the reply"
                if evidence["registry"] in tvy.tevers:
                    state = tvy.tevers[evidence["registry"]].vcState(evidence["credential"])
                    if state and (not events or events[-1] != state.et):
                        events.append(state.et)
            assert events == ["iss", "rev"], events
            final = tvy.tevers[evidence["registry"]].vcState(evidence["credential"])
            assert final.s == "1" and final.d == evidence["revocation"]
            return dict(genus=genus, events=events, said=final.d)


evidence = json.loads(Path(args.evidence).read_text())
print(json.dumps([observe(evidence, genus) for genus in ([1] if args.legacy else [1, 2])]))
