---
"keri-ts": patch
---

The LMDB backend now depends on `@keri-ts/lmdb-js` 3.5.10-v1.2 instead of `lmdb` 3.5.3. It is lmdb-js 3.5.10
compiled for LMDB 0.9.29 (data format version 1, the format KERIpy reads), N-API only, with the environment close
fix (kriszyp/lmdb-js#388), and it ships prebuilt binaries for linux-x64 and linux-arm64 (glibc and musl, so Alpine
works) and darwin-arm64, so installing keri-ts compiles nothing. Node and Deno consumers previously got the stock `lmdb` addon,
which writes data format version 2, unless they rebuilt it: stores written that way cannot be opened by this release
(LMDB crashes the process on a format mismatch), so start from fresh stores. The in-place rebuild
(`setup:compat-lmdb`, `setup_lmdb_v1.sh` and its close patch) is removed.
