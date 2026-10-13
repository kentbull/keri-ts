"""Frozen semantic disclosure oracle; compact raw is normalized through Mapper."""
import copy
import json
import pathlib
import subprocess
import sys
from keri.core import mapping

REFERENCE = "927c0cb8794d7c84fc17143c67df64aab9deda6c"
root = pathlib.Path(mapping.__file__).resolve().parents[3]
assert subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() == REFERENCE
for name, module in list(sys.modules.items()):
    if name.startswith("keri.") and getattr(module, "__file__", None):
        path = pathlib.Path(module.__file__).resolve()
        if path.suffix == ".py":
            assert path.read_bytes() == subprocess.check_output(["git", "-C", str(root), "show", f"{REFERENCE}:{path.relative_to(root)}"]), str(path)

source = dict(d="", name=dict(d="", value="Alice"), grades=dict(d="", math=dict(d="", value="A"), art=dict(d="", value="B")), role="holder")

def partials(compactor):
    """Capture independent canonical partial maps and serialized bytes."""
    return [dict(paths=list(paths), mad=partial.mad, raw=partial.raw.hex()) for paths, partial in (compactor.partials or {}).items()]

formats = []
for kind in ("CESR", "JSON", "CBOR", "MGPK"):
    c = mapping.Compactor(mad=copy.deepcopy(source), kind=kind, verify=False)
    c.compact()
    canonical = mapping.Mapper(mad=c.mad, kind=kind, verify=False)
    c.expand()
    formats.append(dict(kind=kind, compact=c.mad, raw=canonical.raw.hex(), leaves=list(c.leaves), expanded=partials(c)))

paths = []
for selected in (["a/grades/math/value"], ["a/grades/"], ["a/"], ["a/2/1/1"], ["a/name/value", "a/grades/art/value"], ["a/grades/", "a/grades/math/value", "a/grades/"], [], ["s/name"]):
    c = mapping.Compactor(mad=copy.deepcopy(source), verify=False)
    c.compact(paths=selected, root="a")
    paths.append(dict(paths=selected, partials=partials(c)))
# Exact tuple traversal must distinguish a dotted label from nested labels.
collision_source = {"d": "", "a.b": {"d": "", "value": "literal"}, "a": {"b": {"d": "", "value": "nested"}}}
c = mapping.Compactor(mad=collision_source, strict=False, verify=False)
collision_paths = ["a/1/value", "a/2/b/value"]
c.compact(paths=collision_paths, root="a")
collision = dict(source=collision_source, paths=collision_paths, partials=partials(c))
json.dump(dict(reference=REFERENCE, source=source, formats=formats, paths=paths, collision=collision), sys.stdout, indent=2)
print()
print(f"reference={REFERENCE} python={sys.version.split()[0]} module={mapping.__file__}", file=sys.stderr)
