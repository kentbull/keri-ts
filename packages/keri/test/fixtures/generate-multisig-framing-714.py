"""Generate v1 multisig wrappers with v2 child attachments from canonical KERIpy 714.

Run in Docker without host bind mounts, with the frozen checkout on PYTHONPATH.
Only the clock is fixed; real habitats build/sign each child. Parent endorsements
are removed because keri-ts builders return unsigned bodies plus supplemental wire.
"""
import importlib.util
import json
import pathlib
import subprocess
from unittest.mock import patch

import keri
from keri.app import grouping, habbing
from keri.kering import Vrsn_1_0, Vrsn_2_0

REFERENCE = "7143832813cac6a394ab1faf9be83bb3372be87c"
STAMP = "2026-10-15T00:00:00.000000+00:00"


def vectors():
    """Produce four route vectors and an intrinsic-genus control with real habitats."""
    root = pathlib.Path(keri.__file__).resolve().parents[2]
    assert subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() == REFERENCE
    assert not subprocess.check_output(["git", "-C", str(root), "status", "--porcelain", "--untracked-files=no"], text=True).strip()
    with patch("keri.help.helping.nowIso8601", return_value=STAMP), habbing.openHab(
        name="multisig-framing-714", salt=b"0123456789abcdef", temp=True, version=Vrsn_1_0
    ) as (hby, member):
        mids = [member.pre]
        # Distinguish this group from the member despite using the same one-key set.
        group = hby.makeGroupHab(group="group", mhab=member, smids=mids, rmids=mids,
                                data=[dict(i=member.pre, s="0", d=member.kever.serder.said)],
                                isith="1", nsith="1", version=Vrsn_1_0)
        assert group.pre != member.pre
        data = {"reference": REFERENCE, "stamp": STAMP, "sender": member.pre,
                "members": mids, "group": group.pre, "cases": {}}

        def record(label, child, parent, attachments, expected_hint=(2, 0)):
            proof = member.endorse(serder=parent, last=False, framed=True, gvrsn=Vrsn_1_0)[parent.size:]
            assert attachments.startswith(proof)
            assert parent.ked["a"].get("cgvrsn") == (list(expected_hint) if expected_hint else None)
            data["cases"][label] = {"child": child.decode(), "parent": parent.raw.decode(),
                                     "supplemental": attachments[len(proof):].decode()}

        child = group.msgOwnInception(framed=True, gvrsn=Vrsn_2_0)
        record("icp", child, *grouping.multisigInceptExn(member, mids, mids, child,
                                                        version=Vrsn_1_0, gvrsn=Vrsn_2_0))
        member.rotate(version=Vrsn_1_0)
        child = group.rotate(verfers=member.kever.verfers, digers=member.kever.ndigers,
                             framed=True, gvrsn=Vrsn_2_0, version=Vrsn_1_0)
        record("rot", child, *grouping.multisigRotateExn(group, mids, mids, child,
                                                       version=Vrsn_1_0, gvrsn=Vrsn_2_0))
        child = group.interact(framed=True, gvrsn=Vrsn_2_0, version=Vrsn_1_0)
        record("ixn", child, *grouping.multisigInteractExn(group, mids, child,
                                                         version=Vrsn_1_0, gvrsn=Vrsn_2_0))
        child = group.reply(route="/end/role/add", data={"cid": group.pre, "role": "controller", "eid": member.pre},
                             framed=True, gvrsn=Vrsn_2_0, version=Vrsn_1_0)
        record("rpy", child, *grouping.multisigRpyExn(group, child, version=Vrsn_1_0, gvrsn=Vrsn_2_0))
        intrinsic = hby.makeGroupHab(group="group-v2", mhab=member, smids=mids, rmids=mids,
                                    isith="1", nsith="1", version=Vrsn_2_0)
        child = intrinsic.msgOwnInception(framed=True, gvrsn=Vrsn_2_0)
        record("intrinsic", child, *grouping.multisigInceptExn(member, mids, mids, child,
                                                              version=Vrsn_1_0, gvrsn=Vrsn_2_0),
               expected_hint=None)

    probe_path = pathlib.Path(__file__).resolve().parents[4] / "scripts/ci/probe-keripy.py"
    spec = importlib.util.spec_from_file_location("keripy_probe", probe_path)
    probe = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(probe)
    probe.loaded_modules(root, REFERENCE, root / "src/keri")
    return data


if __name__ == "__main__":
    print(json.dumps(vectors(), indent=2))
