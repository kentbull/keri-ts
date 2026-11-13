# Upgrading from 2.0.x

This guide is for anyone running or building on **keri-ts 2.0.0 or 2.0.1** and
the matching `@keri-ts/*` packages upgrading to **2.1.0**, the first release
containing the pluggable store contract (ADR-0015), the `keri-ts/db/lmdb` and
`keri-ts/runtime/node` entrypoints, and the KERIpy path fixes.

Upgrade every `@keri-ts/*` package together, because each pins `keri-ts` to an
exact version. LMDB data keeps its format and does not need converting. No
aliases or migration readers are provided for old keri-ts file locations; where a
file must move, this guide gives the commands.

## 1. Before you upgrade

1. Stop every keri-ts or Tufa process using the stores and configs below.
2. Back up the store roots you use. The defaults are `/usr/local/var/keri/` and,
   when that was not writable, `~/.tufa/`, or `~/.keri/` with `--compat`. Include
   any `--head-dir` and `--config-dir` you pass.

## 2. Move config files

Config files now sit directly under their base directory, as in KERIpy.

| 2.0.x                                      | Now                                 |
| ------------------------------------------ | ----------------------------------- |
| `<head>/keri/cf/<name>/<name>.json`        | `<head>/keri/cf/<name>.json`        |
| `<head>/keri/cf/<base>/<name>/<name>.json` | `<head>/keri/cf/<base>/<name>.json` |
| `~/.tufa/cf/<name>/<name>.json` (fallback) | `~/.tufa/cf/<name>.json`            |

With `--compat`, the home fallback is now `~/.keri/cf/<name>.json`.

If you skip this step, the new version creates an empty `{}` config at the new
path and starts without your bootstrap URLs, witness lists or other settings. The
old file stays in place, so nothing is lost, but it is no longer read.

This moves every old-layout file under one root. It never overwrites an existing
file, is safe to re-run, and only touches files named after their parent
directory.

```sh
move_cf() {
  # usage: move_cf <cf-root>, for example /usr/local/var/keri/cf or ~/.tufa/cf
  root="$1"
  [ -d "$root" ] || return 0
  find "$root" -mindepth 2 -maxdepth 3 -type f -name '*.json' | while read -r f; do
    dir=$(dirname "$f"); name=$(basename "$dir")
    [ "$(basename "$f")" = "$name.json" ] || continue
    dest="$(dirname "$dir")/$name.json"
    if [ -e "$dest" ]; then
      echo "skip: $dest already exists (old file left at $f)"
    else
      mv -n "$f" "$dest" && rmdir "$dir" 2>/dev/null
      echo "moved: $f -> $dest"
    fi
  done
}
move_cf /usr/local/var/keri/cf
move_cf "$HOME/.tufa/cf"
move_cf "$HOME/.keri/cf"
# Repeat for each --config-dir you use:
# move_cf "<config-dir>/keri/cf"
```

If you use `--compat` and your config had fallen back to `~/.tufa/cf`, move it
after running the above:

```sh
mkdir -p "$HOME/.keri/cf"
mv -n "$HOME/.tufa/cf/<name>.json" "$HOME/.keri/cf/<name>.json"
```

Code that calls `createConfiger` or constructs `Configer` **without a `base`**
now uses KERIpy's default base, `main`, so the file is read from
`<head>/keri/cf/main/<name>.json`. Pass `base: ""` to keep
`<head>/keri/cf/<name>.json`.

## 3. Check for a stranded store

In 2.0.x, when a store fell back to your home directory, a second open of the
same store object in one process could write to `~/keri/<kind>/<name>`, with no
leading dot. No shipped Tufa command does this, so most installations are
unaffected, but code that reopens a store object could be. The new release does
not look there.

```sh
find "$HOME/keri" -name data.mdb -exec ls -l {} \; 2>/dev/null
```

If this prints nothing, you are not affected. Otherwise compare modification
times with the same `<name>` under `~/.tufa/<kind>/`, or `~/.keri/<kind>/` with
`--compat`, and move the copy you want to keep. Never merge two LMDB directories
by copying files between them.

## 4. Update imports

Move these imports. Everything not listed stays where it was.

| Names                                                                                                                                                                                              | From              | To                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------- |
| `LMDBer`, `LMDBerOptions`, `LMDBerDefaults`, `LMDBER_DEFAULTS`, `openLMDB`, `createLMDBer`, `readStoredLmdbMapSize`, `resolveLmdbMapSize`, `clearDatabaserDir`, `BinKey`, `BinVal`                 | `keri-ts/db`      | `keri-ts/db/lmdb`      |
| `PathManager`, `PathManagerOptions`, `PathManagerDefaults`, `PATH_DEFAULTS`                                                                                                                        | `keri-ts/db`      | `keri-ts/db/lmdb`      |
| `createBaser`, `createKeeper`, `createNoter`, `createMailboxer`, `createReger`                                                                                                                     | `keri-ts/db`      | `keri-ts/db/lmdb`      |
| `createHabery`                                                                                                                                                                                     | `keri-ts/runtime` | `keri-ts/db/lmdb`      |
| `Configer`, `ConfigerOptions`, `createConfiger`                                                                                                                                                    | `keri-ts/runtime` | `keri-ts/runtime/node` |
| `fileBytes`, `socketBytes`, `SocketSourceOptions`                                                                                                                                                  | `keri-ts/runtime` | `keri-ts/runtime/node` |
| `TCPMessenger`, `TCPMessengerOptions`, `TCPStreamMessenger`                                                                                                                                        | `keri-ts/runtime` | `keri-ts/runtime/node` |
| `openTcpConnection`, `sendCesrTcp`, `sendCesrTcpFrame`, `sendCesrTcpSocket`, `streamCesrTcp`, `writeCesrTcpSocket`, `TcpConnection`, `TcpSendOptions`, `TcpSocketWriteOptions`, `TcpSourceFactory` | `keri-ts/runtime` | `keri-ts/runtime/node` |

`keri-ts/db` and `keri-ts/runtime` no longer load the native LMDB addon, `node:`
modules or the `Deno` global, so they can be bundled for a browser.

## 5. Update code

### TCP endpoints need `NodeHttpClient`

`FetchHttpClient` still works for HTTP. Reaching a `tcp:` witness, mailbox or
recipient through it now fails with
`ValidationError: TCP endpoints are unavailable on this host.`

```ts
// 2.0.x
import { createAgentRuntime, FetchHttpClient, systemClock } from "keri-ts/runtime";
const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);

// Now
import { createAgentRuntime, systemClock } from "keri-ts/runtime";
import { NodeHttpClient } from "keri-ts/runtime/node";
const runtime = yield* createAgentRuntime(hby, new NodeHttpClient(), systemClock);
```

### Opening a Habery

`createHabery` keeps its arguments; only its import changes. The new
backend-neutral `openHabery` must be told where stores come from and what to do
about the config file:

```ts
import { LmdbStoreOpener } from "keri-ts/db/lmdb";
import { openHabery } from "keri-ts/runtime";
import { createConfiger } from "keri-ts/runtime/node";

const hby = yield* openHabery({
  name,
  base,
  headDirPath,
  compat,
  opener: new LmdbStoreOpener({ headDirPath, compat }),
  createConfig: createConfiger, // or cf: existingConfiger, or skipConfig: true
});
```

### Opening a registry store

`openRegistry` now requires an `opener`. Its `web` option is removed.

```ts
// Backend-neutral
const baser = yield * openRegistry({ ...hby.storeIdentity(), opener: hby.opener });

// LMDB default, from keri-ts/db/lmdb
const baser = yield * openLmdbRegistry({ name, base, temp });
```

### Constructing stores directly

`Baser`, `Keeper`, `Reger`, `Noter`, `Mailboxer` and `RegBaser` constructors now
take a `DBer` rather than options. Use `createBaser` and its siblings, which
return open stores, or `lmdbBaser`, `lmdbKeeper`, `lmdbNoter` and `lmdbMailboxer`,
which return closed stores, all from `keri-ts/db/lmdb`.

`WalletBaser` and `VerifierCueBaser` changed the same way. Use
`createWalletBaser` (from `@keri-ts/wallet/lmdb`) and `createVerifierCueBaser`. The statics
`VerifierCueBaser.TailDirPath`, `AltTailDirPath`, `CompatAltTailDirPath` and
`TempPrefix` are replaced by `VerifierCueBaser.Family`.

`Komer` and `Suber` take any `DBer`. Their `sdb` is now an opaque `Table`; use
`lmdbTable(sdb)` from `keri-ts/db/lmdb` if you need the native handle.
`LMDBer`'s table methods take the same `Table`, which `openDB` and `openTable`
return.

### Grant walk policy

Grants now walk open by default, as in KERIpy: a far node the Grant does not
carry is a permanent unknown, so an OR group with a valid sibling accepts. Pass
`grantWalk: "closed"` to `createAgentRuntime` or `loadIpexHandlers` to keep the
2.0 behavior of refusing every Grant that omits a far node. `walkIpexGraph` takes
`"open"` or `"closed"` instead of a `closed` boolean, and `AcdcGraph` requires
`walk`.

## 6. Behavior changes to check

**Storage**

- Writing an empty value to a dupsort table, or an empty or over-long key, now
  throws `DatabaseKeyError`. `addVal` no longer accepts `null`.
- `LMDBer` no longer throws a bare `Error`. Expect `DatabaseKeyError`,
  `DatabaseNotOpenError` or `DatabaseOperationError`.
- `getVals`, `getValLast`, `getValsIter`, `cntVals` and `seekVal` with an empty
  key now report absent. They previously read the table's first key.

**Paths and permissions**

- `--base` and the `base` option must be relative. An absolute value fails with
  `InvalidPathNameError`.
- The store directory and config file are set to mode `1700` on every open,
  including existing ones. New `data.mdb` and `lock.mdb` files are `1600`.
  Existing database files are left alone. If another user or a container with a
  different uid reads these paths, give it ownership before starting.
- If a store directory exists but the running user cannot read and write it, the
  process now falls back to `~/.tufa/<kind>/<name>`, or `~/.keri/<kind>/<name>`
  with `--compat`, and starts with an empty store rather than failing. If
  identifiers seem to be missing after upgrading, check ownership first.
- An unusable `--head-dir` falls back to the home directory in the same way.

**Protocol**

- Messages to a recipient, witness or mailbox whose latest accepted event is
  KERI v1 are refused rather than sent as v2. Rotate with `--version 2.0` to
  upgrade a v1 identifier deliberately.
- A message that fails validation is skipped, and the rest of its stream is still
  processed, as in KERIpy.
- A v2 ACDC attribute, edge or rule section without a top-level `d` is no longer
  given one. Building the same body now yields KERIpy's bytes and SAID rather
  than the 2.0.x ones. Credentials authored by 2.0.x carry the inserted `d` and
  still verify.

## 7. Verify the upgrade

1. `tufa --version` reports the new version.
2. Start each agent or witness with the same `--config-dir`, `--config-file`,
   `--head-dir`, `--base` and `--compat` as before. Confirm
   `<head>/keri/cf/<name>.json` is your moved file rather than `{}`.
3. `ls -ld /usr/local/var/keri/db/<name>`, or the home fallback, shows
   `drwx-----T` and the expected owner.
4. `tufa list --name <name>` shows the identifiers you expect. If any are missing,
   check the fallback locations in sections 1 and 3 before writing anything.
5. Type-checking passes with the import changes applied, and anything that sends
   to a `tcp:` endpoint uses `NodeHttpClient`.
