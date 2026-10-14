"""Run CESR corpus cases in fresh, memory/time-bounded Deno processes."""
import argparse
import hashlib
import json
import os
import platform
import subprocess
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", required=True)
parser.add_argument("--payload-mib", type=int, nargs="+", default=[16, 256])
parser.add_argument("--item-kib", type=int, nargs="+", default=[1024])
parser.add_argument("--chunk-kib", type=int, nargs="+", default=[64])
parser.add_argument("--depth", type=int, nargs="+", default=[1])
parser.add_argument("--genus", type=int, choices=[1, 2], default=2)
parser.add_argument("--binary", action="store_true")
parser.add_argument("--repeats", type=int, default=1)
parser.add_argument("--timeout", type=float, default=120)
parser.add_argument("--max-rss-mib", type=int, default=768)
args = parser.parse_args()
metadata = {
    "revision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
    "dirty": subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True).strip(),
    "harness_sha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((ROOT / "scripts/bench").glob("*")) if p.is_file()},
    "platform": platform.platform(),
    "processor": platform.processor(),
    "cpu_count": os.cpu_count(),
    "rss_limit_mib": args.max_rss_mib,
    "timeout_seconds": args.timeout,
    "sampling_seconds": 0.1,
    "clock": "monotonic",
    "note": "Parser-only synthetic ESSR; no encryption, signature verification, storage, or network measurement.",
}
# Preserve every sample before reporting an unsuccessful qualification to CI.
failed = False
with open(args.output, "w") as report:
    for mib in args.payload_mib:
        for kib in args.item_kib:
            for chunk in args.chunk_kib:
                for depth in args.depth:
                    for repetition in range(args.repeats):
                        options = dict(payloadBytes=mib * 1048576, itemBytes=kib * 1024,
                                       chunkBytes=chunk * 1024, depth=depth,
                                       genus=args.genus, binary=args.binary)
                        with tempfile.TemporaryFile(mode="w+") as stdout, tempfile.TemporaryFile(mode="w+") as stderr:
                            proc = subprocess.Popen(["deno", "run", "-A", "scripts/bench/cesr-worker.ts", json.dumps(options)],
                                                    cwd=ROOT, stdout=stdout, stderr=stderr)
                            start = time.monotonic()
                            peak_rss = 0
                            failure = None
                            while proc.poll() is None:
                                sample = subprocess.run(["ps", "-o", "rss=", "-p", str(proc.pid)], capture_output=True, text=True)
                                if sample.returncode == 0 and sample.stdout.strip():
                                    peak_rss = max(peak_rss, int(sample.stdout.strip()) * 1024)
                                if peak_rss > args.max_rss_mib * 1048576:
                                    failure = "memory-limit"
                                elif time.monotonic() - start > args.timeout:
                                    failure = "timeout"
                                if failure:
                                    proc.kill()
                                    break
                                time.sleep(0.1)
                            proc.wait()
                            stdout.seek(0)
                            stderr.seek(0)
                            output = stdout.read().strip()
                            try:
                                result = json.loads(output)
                            except json.JSONDecodeError:
                                result = {"status": failure or "process-error", "stderr": stderr.read()[-4000:]}
                            result.update(metadata=metadata, options=options, repetition=repetition,
                                          exitCode=proc.returncode, sampledPeakRss=peak_rss,
                                          wallSeconds=time.monotonic() - start)
                            if failure:
                                result["status"] = failure
                            failed |= result["status"] != "ok" or proc.returncode != 0
                            report.write(json.dumps(result) + "\n")
                            report.flush()
                            print(f"{mib} MiB, {kib} KiB items, depth {depth}, run {repetition}: {result['status']}", flush=True)

raise SystemExit(1 if failed else 0)
