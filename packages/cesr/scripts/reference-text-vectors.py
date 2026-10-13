"""Generate frozen text vectors or decode actual TS output in both wire domains.

Run with PYTHONPATH selecting KERIpy 927c0cb8. This probe opens no databases.
"""
import json
import pathlib
import subprocess
import sys

from keri.core import coring

# Text semantics are pinned independently of any runtime interop environment.
REFERENCE = "927c0cb8794d7c84fc17143c67df64aab9deda6c"


def verify_source():
    """Reject a different checkout or modified imported coring implementation."""
    source = pathlib.Path(coring.__file__).resolve()
    root = source.parents[3]
    assert subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() == REFERENCE
    frozen = subprocess.check_output(["git", "-C", str(root), "show", f"{REFERENCE}:{source.relative_to(root)}"])
    assert frozen == source.read_bytes()
    print(f"reference={REFERENCE} python={sys.version.split()[0]} module={source}", file=sys.stderr)


def encoded(value):
    """Record binary expectations independently of TS's base64 conversion."""
    return {"qb64": value.qb64, "qb2": value.qb2.hex()}


def generate():
    """Cover empty values, escape characters, and each length-modulo-four case."""
    texts = ["", "A", "AA", "AAA", "AAAA", "AAAAA", "AAAAAA", "AAAAAAA", "AAAAAAAA",
             "-", "--", "---", "----", "-abc", "-abcd", "-abcde", "-abcdef",
             "b", "bc", "bcd", "bcde", "_", "_abc"]
    bexters = [{"text": text, "escapive": True, **encoded(coring.Bexter(bext=text))} for text in texts]
    bexters += [{"text": text, "escapive": False, **encoded(coring.Bexter(bext=text, escapive=False))}
                for text in ["-", "--", "bcd"]]
    labels = [{"text": prefix + "b" * (length - 1),
               **encoded(coring.Labeler(text=prefix + "b" * (length - 1)))}
              for prefix in ["A", "-", "_"] for length in range(12, 16)]
    paths = [{"text": text, "relative": relative,
              "path": coring.Pather(path=text, relative=relative).path,
              **encoded(coring.Pather(path=text, relative=relative))}
             for text in ["", "/", "A", "AA", "AAA", "AAAA", "AAA/b", "a/b"]
             for relative in [False, True]]
    return {"reference": REFERENCE, "bexters": bexters, "labels": labels, "paths": paths}


def verify_ts(data):
    """Consume independently emitted TS wire, checking semantics and exact extent."""
    count = 0
    for family, primitive, accessor in [("bexters", coring.Bexter, "bext"),
                                       ("labels", coring.Labeler, "text"),
                                       ("paths", coring.Pather, "path")]:
        for vector in data[family]:
            expected = vector["path"] if family == "paths" else vector["text"]
            options = {"escapive": vector["escapive"]} if family == "bexters" else {}
            for domain in ["qb64", "qb2"]:
                wire = vector[domain].encode() if domain == "qb64" else bytes.fromhex(vector[domain])
                stream = bytearray(wire + b"TAIL")
                parsed = primitive(**{"qb64b" if domain == "qb64" else "qb2": stream}, strip=True, **options)
                assert getattr(parsed, accessor) == expected, (family, vector, domain)
                assert encoded(parsed) == {key: vector[key] for key in ["qb64", "qb2"]}
                assert stream == b"TAIL"
                count += 1
    print(f"Verified {count} TS text tokens with frozen Python in qb64/qb2.")


if __name__ == "__main__":
    verify_source()
    if len(sys.argv) == 2:
        verify_ts(json.loads(pathlib.Path(sys.argv[1]).read_text()))
    else:
        print(json.dumps(generate(), indent=2))
