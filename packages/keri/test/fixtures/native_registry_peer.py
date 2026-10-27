"""Live native registry builders and read-only vetting against independently parsed KELs.

This driver parses foreign KELs and calls the candidate's read-only native proof
APIs. It does not exercise Python wallet or registry persistence.
"""
import argparse
import json
from pathlib import Path

from keri import Vrsn_2_0
from keri.acdc.messaging import acdcmap, blindate, regcept
from keri.acdc.regeventing import vet, vetBinds
from keri.app import openHby
from keri.core import Blinder, BlindState, Kevery, Parser, SerderACDC


def author():
    """Author fresh evidence using a Python issuer; return only public wire and a disclosure."""
    with openHby(name="native-author", temp=True, version=Vrsn_2_0) as hby:
        issuer = hby.makeHab(name="issuer", version=Vrsn_2_0)
        rip = regcept(issuer.pre)
        issuer.interact(data=[dict(i=rip.said, s="0", d=rip.said)], gvrsn=Vrsn_2_0)
        credential = acdcmap(issuer.pre, regid=rip.said, attribute=dict(d="", name="Ada"))
        opening = Blinder.blind(acdc=credential.said, state="issued", sn=1)
        update = blindate(rip.said, rip.said, opening.said)
        issuer.interact(data=[dict(i=rip.said, s="1", d=update.said)], gvrsn=Vrsn_2_0)
        return dict(rip=rip.raw.decode(), update=update.raw.decode(),
                    credential=credential.raw.decode(), opening=opening.crew._asdict(),
                    kel=b"".join(hby.db.clonePreIter(pre=issuer.pre, gvrsn=Vrsn_2_0)).decode())


def verify(evidence):
    """Verify the foreign KEL normally before invoking read-only native proof APIs."""
    with openHby(name="native-verifier", temp=True, version=Vrsn_2_0) as hby:
        rip, update, credential = [SerderACDC(raw=evidence[key].encode())
                                   for key in ("rip", "update", "credential")]
        kvy = Kevery(db=hby.db, lax=False, local=False)
        Parser(version=Vrsn_2_0, kvy=kvy).parse(ims=bytearray(evidence["kel"].encode()))
        assert hby.db.kevers[rip.issuer.qb64].sn == 2
        opening = Blinder(crew=BlindState(**evidence["opening"]), saidive=True)
        state = vet(rip, [update], db=hby.db, acdc=credential, blinder=opening)
        bound = vetBinds(rip, [update], db=hby.db, acdc=credential,
                        blinders=[opening], target=credential.said)
        assert state == bound
        assert state.regid == rip.said and state.said == update.said
        assert state.acdc == credential.said and state.state == "issued"
        assert state.binding == "mutual" and state.sn == 1
        return state._asdict()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("author", "verify"))
    parser.add_argument("evidence", nargs="?")
    args = parser.parse_args()
    result = author() if args.mode == "author" else verify(json.loads(Path(args.evidence).read_text()))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
