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
from keri.kering import Vrsn_1_0


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
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, stop)

    cf = Configer(name=args.config_file, headDirPath=args.config_dir,
                  temp=False, reopen=True, clear=False)
    hby = Habery(name=args.name, base=args.base, bran=args.passcode,
                 cf=cf, version=Vrsn_1_0)
    try:
        doers = [HaberyDoer(habery=hby)]
        doers.extend(setupWitness(hby=hby, alias=args.alias, httpPort=args.http,
                                 tcpPort=args.tcp, version=Vrsn_1_0))
        runController(doers=doers)
    finally:
        hby.close()
        cf.close()


if __name__ == "__main__":
    main()
