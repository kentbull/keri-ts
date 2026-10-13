"""Run the verified KERIpy console entry point without changing its exit status.

Executing the CLI module with ``-m`` can ignore ``main()``'s return value. The
installed ``kli`` console script instead passes that value to ``sys.exit``.
"""

import importlib
import sys


def main():
    """Import the independently verified CLI module and preserve console semantics."""
    module = importlib.import_module(sys.argv.pop(1))
    sys.argv[0] = "kli"
    return module.main()


if __name__ == "__main__":
    raise SystemExit(main())
