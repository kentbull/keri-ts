"""Launch the reusable KERIpy peer; TypeScript tests choose the scenario steps."""
import json
from pathlib import Path
import signal
import sys

from ipex_peer import open_peer


def main():
    root, graph = sys.argv[1:]
    with open_peer(None if graph == "-" else graph) as peer:
        signal.signal(signal.SIGTERM, lambda *_: peer.stop())
        # Publish complete coordinates atomically to the polling parent.
        pending = Path(root, "ready.pending")
        pending.write_text(json.dumps(peer.info()))
        pending.replace(Path(root, "ready.json"))
        peer.serve()


if __name__ == "__main__":
    main()
