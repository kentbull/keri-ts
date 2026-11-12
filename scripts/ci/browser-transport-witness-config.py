"""Write the KERIpy witness config the transport probe serves: `wan` with the given curls.

Usage: browser-transport-witness-config.py <source wan.json> <config dir> <tcp port> <http port>
The config lands where `kli init --config-dir` looks, both directly and under `main/`.
"""

import json
import sys
from pathlib import Path

source, root, tcp, http = sys.argv[1:5]
config = json.loads(Path(source).read_text())
config["wan"]["curls"] = [f"tcp://127.0.0.1:{tcp}/", f"http://127.0.0.1:{http}/"]
for directory in (Path(root) / "keri/cf", Path(root) / "keri/cf/main"):
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "wan.json").write_text(json.dumps(config))
