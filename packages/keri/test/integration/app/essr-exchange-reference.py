"""Exercise pinned ESSR sender APIs, parser, Exchanger, escrow and recipient crypto."""
import argparse
import base64
import json

import pysodium

from keri.app import configing, forwarding, habbing
from keri import kering
from keri.core import coring, eventing, parsing, Counter, Codens
from keri.peer import exchanging


def encoded(raw):
    return base64.b64encode(raw).decode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("create", "receive"))
    parser.add_argument("head")
    parser.add_argument("input")
    args = parser.parse_args()
    with open(args.input) as stream:
        data = json.load(stream)
    genus = data["genus"]
    version = kering.Vrsn_2_0 if genus == 2 else kering.Vrsn_1_0
    version_args = {"version": version} if genus == 2 else {}
    cf = configing.Configer(name="essr-peer", headDirPath=args.head, temp=False, reopen=True)
    hby = habbing.Habery(name="essr-peer", headDirPath=args.head,
                        cf=cf, temp=False, **version_args)
    try:
        kvy = eventing.Kevery(db=hby.db, lax=True, local=False)
        psr = parsing.Parser(kvy=kvy, exc=hby.exc, **version_args)
        if args.action == "create":
            hab = hby.makeHab("peer")
            psr.parse(ims=bytearray(base64.b64decode(data["kel"])))
            assert data["recipient"] in hby.kevers
            if hasattr(exchanging, "exchange"):
                inner, _ = exchanging.exchange(route="/essr/inner", payload={"message": "python"}, sender=hab.pre)
            else:
                inner = eventing.exchange(route="/essr/inner", attributes={"message": "python"},
                                          sender=hab.pre, pvrsn=kering.Vrsn_1_0, kind=kering.Kinds.json)
            endorse_args = {"framed": True, "gvrsn": version, "genusify": True} if genus == 2 else {"pipelined": False}
            inner_wire = hab.endorse(inner, **endorse_args)
            if hasattr(forwarding, "PayloadTyper"):
                tag = forwarding.PayloadTyper(type=forwarding.PayloadTypes.SCS).qb64b
            elif hasattr(forwarding, "payloading"):
                tag = forwarding.payloading.PayloadTyper(type=forwarding.payloading.PayloadTypes.SCS).qb64b
            else:
                # 1.3 supports opaque ESSR; its StreamPoster has no SCS wrapper.
                tag = b"XSCS"
            plain = tag + hab.kever.prefixer.qb64b + coring.Bexter(bext="").qb64b + inner_wire
            if hasattr(forwarding.StreamPoster, "_essrWrapper"):
                poster = forwarding.StreamPoster(hby=hby, hab=hab, recp=data["recipient"],
                                                  essr=True, **version_args)
                wire = poster._essrWrapper(hab, plain, data["recipient"])
            else:
                # Match 1.3's own test_essrs: real crypto, exchange, endorsement and counter APIs.
                key = hby.kevers[data["recipient"]].verfers[0]
                raw = pysodium.crypto_box_seal(plain, pysodium.crypto_sign_pk_to_box_pk(key.raw))
                texter = coring.Texter(raw=raw)
                outer, _ = exchanging.exchange(route="/essr/req", sender=hab.pre,
                    diger=coring.Diger(ser=raw), modifiers=dict(src=hab.pre, dest=data["recipient"]))
                wire = hab.endorse(serder=outer, pipelined=False)
                wire.extend(Counter(Codens.ESSRPayloadGroup, count=1, gvrsn=version).qb64b)
                wire.extend(texter.qb64b)
            replay_args = {"gvrsn": version} if genus == 2 else {}
            print(json.dumps({"sender": hab.pre, "kel": encoded(hab.replay(**replay_args)),
                              "wire": encoded(wire), "inner": inner.said}))
        else:
            hab = hby.habByName("peer")
            # Pinned main drops ESSR on unknown-sender escrow. Supply its KEL
            # first; do not patch the peer or claim its escrow retry passed.
            if genus == 2:
                psr.parse(ims=bytearray(base64.b64decode(data["kel"])))
                psr.parse(ims=bytearray(base64.b64decode(data["wire"])))
            else:
                psr.parse(ims=bytearray(base64.b64decode(data["wire"])))
                assert hby.db.exns.get(keys=(data["said"],)) is None
                assert hby.db.epse.get(keys=(data["said"],)) is not None
                assert hby.db.essrs.get(keys=(data["said"],))
                psr.parse(ims=bytearray(base64.b64decode(data["kel"])))
                hby.exc.processEscrow()
            assert data["sender"] in hby.kevers
            assert hby.exc.complete(data["said"])
            exn = hby.db.exns.get(keys=(data["said"],))
            fragments = hby.db.essrs.get(keys=(data["said"],))
            raw = b"".join(part.raw for part in fragments)
            assert coring.Diger(qb64=exn.ked["a"]).verify(ser=raw)
            plain = hab.decrypt(raw)
            assert bytes(plain) == base64.b64decode(data["plaintext"])
            print(json.dumps({"accepted": exn.said, "digest": True, "plaintext": True, "escrowRetry": genus == 1}))
    finally:
        hby.close()


if __name__ == "__main__":
    main()
