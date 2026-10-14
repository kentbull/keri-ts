"""Verify the exact imported KERIpy runtime before interop creates any stores."""
import argparse
import hashlib
import importlib
import importlib.metadata as metadata
import importlib.util
import json
import pathlib
import subprocess
import sys


def main():
    """Report source/interpreter provenance, failing closed on a requested mismatch."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-commit")
    parser.add_argument("--root")
    parser.add_argument("--resolver-root")
    parser.add_argument("--resolver-commit")
    args = parser.parse_args()
    import keri

    module = pathlib.Path(keri.__file__).resolve()
    distribution = metadata.distribution("keri")
    if args.root:
        root = pathlib.Path(args.root).resolve()
        commit = subprocess.check_output(
            ["git", "-C", str(root), "rev-parse", "HEAD"], text=True
        ).strip()
        dirty = subprocess.check_output(
            ["git", "-C", str(root), "status", "--porcelain", "--untracked-files=no"],
            text=True,
        ).strip()
        if dirty:
            raise SystemExit(f"KERIpy checkout has tracked changes: {root}\n{dirty}")
        expected_module = root / "src" / "keri" / "__init__.py"
    else:
        # An installed version label cannot distinguish commits sharing 1.2.14.
        direct = json.loads(distribution.read_text("direct_url.json") or "{}")
        commit = direct.get("vcs_info", {}).get("commit_id")
        root = None
        expected_module = pathlib.Path(distribution.locate_file("keri/__init__.py")).resolve()
    if args.expected_commit and commit != args.expected_commit:
        raise SystemExit(f"Expected KERIpy {args.expected_commit}, imported source reports {commit!r}")
    if module != expected_module:
        raise SystemExit(f"Expected imported KERIpy at {expected_module}, got {module}")

    # Both historical and current layouts are real KERIpy entrypoints, not port API aliases.
    cli_module = next(
        (name for name in ("keri.cli.kli", "keri.app.cli.kli")
         if module_exists(name)), None
    )
    if cli_module is None:
        raise SystemExit("Verified KERIpy runtime has no KLI module")
    importlib.import_module(cli_module)
    dependencies = {}
    for name in ("keri", "hio", "lmdb", "pysodium", "blake3"):
        try:
            dependencies[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            dependencies[name] = None
    result = {
        "commit": commit,
        "root": str(root) if root else None,
        "module": str(module),
        "python": sys.executable,
        "pythonVersion": sys.version,
        "cliModule": cli_module,
        "dependencies": dependencies,
        "importVerification": "git-bytes" if root else "installed-record",
        "loadedModules": loaded_modules(root, commit, expected_module.parent),
    }
    if args.resolver_root:
        import dws

        resolver_root = pathlib.Path(args.resolver_root).resolve()
        resolver_commit = subprocess.check_output(
            ["git", "-C", str(resolver_root), "rev-parse", "HEAD"], text=True
        ).strip()
        resolver_module = pathlib.Path(dws.__file__).resolve()
        if resolver_commit != args.resolver_commit:
            raise SystemExit(f"Expected resolver {args.resolver_commit}, got {resolver_commit}")
        if resolver_module != resolver_root / "src" / "dws" / "__init__.py":
            raise SystemExit(f"Resolver imports another checkout: {resolver_module}")
        # Cache installation can normalize executable bits; imported source bytes must still match.
        dirty = subprocess.check_output(
            ["git", "-c", "core.filemode=false", "-C", str(resolver_root), "status", "--porcelain", "--untracked-files=no"],
            text=True,
        ).strip()
        if dirty:
            raise SystemExit(f"Resolver checkout has tracked changes: {dirty}")
        result["resolver"] = {
            "root": str(resolver_root), "commit": resolver_commit, "module": str(resolver_module)
        }
    print(json.dumps(result, sort_keys=True))


def loaded_modules(root, commit, package_root):
    """Hash startup imports; editable source must match the pinned Git bytes.

    Installed hashes record observed bytes, not independent Git equivalence.
    Command-specific lazy imports still need qualification in the actual command.
    """
    modules = {}
    for name, module in sorted(sys.modules.copy().items()):
        if name != "keri" and not name.startswith("keri."):
            continue
        path = pathlib.Path(module.__file__).resolve()
        content = path.read_bytes()
        if not path.is_relative_to(package_root):
            raise SystemExit(f"KERIpy import escaped selected package: {name} at {path}")
        if root:
            expected = subprocess.check_output(
                ["git", "-C", str(root), "show", f"{commit}:{path.relative_to(root).as_posix()}"]
            )
            if content != expected:
                raise SystemExit(f"KERIpy imported bytes differ from {commit}: {name} at {path}")
        modules[name] = {"path": str(path), "sha256": hashlib.sha256(content).hexdigest()}
    return modules


def module_exists(name):
    """Probe either CLI layout without treating a missing parent package as a crash."""
    try:
        return importlib.util.find_spec(name) is not None
    except ModuleNotFoundError:
        return False


if __name__ == "__main__":
    main()
