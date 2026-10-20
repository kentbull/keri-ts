"""Start a real KERIpy witness with explicit v1 framing for the v1 interop matrix.

The current ``kli witness start`` opens Habery at the default genus and exposes
``--version`` only for printing the package version. Open the same CLI-created
store through the public library API so both body and attachment expectations
are explicit. Real witness routing, receipt processing, and storage stay intact.
"""

import argparse
import signal

from keri.app.configing import Configer
from keri.app.directing import runController
from keri.app.habbing import Habery, HaberyDoer
from keri.app.indirecting import setupWitness
from keri import kering


def stop(_signal, _frame):
    """Let the controller's ordinary interrupt cleanup release its doers."""
    raise KeyboardInterrupt


def main():
    """Open one isolated fixture store and serve its configured HTTP/TCP ports."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", required=True)
    parser.add_argument("--base", required=True)
    parser.add_argument("--alias", required=True)
    parser.add_argument("--passcode", required=True)
    parser.add_argument("--config-dir", required=True)
    parser.add_argument("--config-file", required=True)
    parser.add_argument("--http", type=int, required=True)
    parser.add_argument("--tcp", type=int, required=True)
    parser.add_argument("--legacy", action="store_true", help="Use the v1-only reference API.")
    parser.add_argument("--messenger-probe", action="store_true", help="Enable test-only transport commands.")
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, stop)

    cf = Configer(name=args.config_file, headDirPath=args.config_dir,
                  temp=False, reopen=True, clear=False)
    version = {} if args.legacy else {"version": kering.Vrsn_1_0}
    hby = Habery(name=args.name, base=args.base, bran=args.passcode, cf=cf, **version)
    mbx = None
    try:
        if args.messenger_probe:
            from keri.app.storing import Mailboxer
            mbx = Mailboxer(name=args.alias, base=hby.base, temp=hby.temp)
        doers = [HaberyDoer(habery=hby)]
        witnesses = setupWitness(hby=hby, alias=args.alias, httpPort=args.http,
                                 tcpPort=args.tcp, mbx=mbx, **version)
        if args.messenger_probe:
            from hio.core import http
            from witness_messenger_probe import MessengerProbe
            probe = MessengerProbe(hby, args.legacy, mbx)
            server = next(doer.server for doer in witnesses if isinstance(doer, http.ServerDoer))
            server.app.add_middleware(probe)
            server.app.add_route("/_messenger", probe)
        doers.extend(witnesses)
        runController(doers=doers)
    finally:
        if mbx is not None:
            mbx.close()
        hby.close()
        cf.close()


if __name__ == "__main__":
    main()
