"""Prepare isolated frozen peers and execute their maintained compatibility owner."""
import json
import os
from pathlib import Path
import shutil
import subprocess


def run(*args, **kwargs):
    """Preserve command failures, leaving logs and peer checkouts available to inspect."""
    subprocess.run(args, check=True, **kwargs)


def main():
    """Keep each reference's source, interpreter and dependencies independent."""
    repo = Path(__file__).resolve().parents[2]
    profiles = json.loads((repo / "scripts/ci/keripy-reference.json").read_text())["profiles"]
    cache = repo / ".cache/keripy-release-profiles"
    cache.mkdir(parents=True, exist_ok=True)
    # The native-v2 candidate has its own owner, outside this frozen release matrix.
    for name in ("main", "1.2", "1.3"):
        profile = profiles[name]
        root = cache / profile["commit"]
        if not root.exists():
            run("git", "init", "--quiet", str(root))
            run("git", "-C", str(root), "remote", "add", "origin",
                f'https://github.com/{profile["repository"]}.git')
            run("git", "-C", str(root), "fetch", "--quiet", "--depth", "1", "origin", profile["commit"])
            run("git", "-C", str(root), "checkout", "--quiet", "--detach", "FETCH_HEAD")
        python = shutil.which(f'python{profile["python"]}')
        if python is None:
            raise RuntimeError(f'Missing Python {profile["python"]} for {name}')
        venv = cache / f'{profile["commit"]}-venv'
        run(python, "-m", "venv", str(venv))
        interpreter = str(venv / "bin/python")
        run(interpreter, "-m", "pip", "install", "-e", str(root),
            f'{profile["hioDistribution"]}=={profile["hio"]}',
            f'lmdb=={profile["lmdb"]}', f'falcon=={profile["falcon"]}')
        env = {**os.environ, "KERIPY_INTEROP_PROFILE": name,
               "KERIPY_INTEROP_ROOT": str(root), "KERIPY_INTEROP_PYTHON": interpreter,
               "KERIPY_INTEROP_EXPECTED_COMMIT": profile["commit"],
               "KERI_TEST_TIMINGS_JSON": str(repo / ".test-timings" / f"reference-{name}.json")}
        run("deno", "run", "-A", "scripts/ci/run-keri-test-group.ts",
            "interop-reference-profiles", cwd=repo, env=env)


if __name__ == "__main__":
    main()
