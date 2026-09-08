"""Verify KERIpy's native library discovery in the hosted macOS shell context."""

import ctypes.util
from pathlib import Path
import sys

import pysodium

expected = Path(sys.argv[1])
discovered = ctypes.util.find_library("sodium") or ctypes.util.find_library("libsodium")
assert discovered and Path(discovered).samefile(expected), "unexpected libsodium discovery"
assert Path(pysodium.sodium._name).samefile(expected), "pysodium loaded a different library"
assert len(pysodium.randombytes(1)) == 1
print(f"KERIpy libsodium: {expected.resolve()}")
print(f"libsodium version: {pysodium.sodium.sodium_version_string().decode()}")
