# KERI-TS Platform Abstraction Design

## Overview

This document outlines the architectural changes required to make `keri-ts` a
platform-agnostic library that supports Deno (Server), Browsers, and potential
future platforms (Mobile/Desktop wrappers) while maintaining a unified core
codebase.

## Problem Statement

Currently, `keri-ts` has direct dependencies on:

1. **Runtime Specific Globals**: `Deno.stat`, `Deno.mkdir`, `Deno.serve`,
   `Deno.env`.
2. **Native Modules**: `lmdb` (C++ bindings) which are incompatible with
   browsers.

To support browser environments (using IndexedDB) and other runtimes, we must
decouple the "Core Logic" (KERI protocol) from the "Infrastructure Logic"
(Storage, Networking, File System).

## Architecture

We will implement a Hexagonal (Ports and Adapters) Architecture for
infrastructure dependencies.

### 1. The `Platform` Interface

The `Platform` interface abstracts OS-level operations that vary between
environments.

```typescript
// src/framework/platform.ts

export interface Platform {
  // Environment
  os: "linux" | "darwin" | "windows" | "browser" | "android" | "ios";

  // File System (May throw "NotSupported" in Browser)
  fs: {
    homeDir(): string;
    tmpDir(): string;
    resolve(...paths: string[]): string;
    mkdir(
      path: string,
      options?: { recursive: true; mode?: number },
    ): Promise<boolean>;
    exists(path: string): Promise<boolean>;
    readText(path: string): Promise<string>;
    writeText(path: string, content: string): Promise<void>;
    remove(path: string, options?: { recursive: true }): Promise<void>;
  };

  // Process/Environment
  env: {
    get(key: string): string | undefined;
  };

  // Path handling (Normalization across OSs)
  path: {
    join(...parts: string[]): string;
  };
}
```

### 2. The `Storage` Interface

This is the most critical abstraction. KERI requires an ordered Key-Value store
(KS) and typically multiple sub-databases (KEL, DEL, etc.).

```typescript
// src/framework/storage.ts
import { Operation } from "effection";

// Binary types for raw storage
export type BinKey = Uint8Array;
export type BinVal = Uint8Array;

/**
 * Represents a connection to a database backend
 */
export interface DBBackend {
  // Lifecycle
  open(): Operation<void>;
  close(): Operation<void>;

  // Sub-database management
  // Returns a handle to a named sub-database (e.g. "evts", "keys")
  openDB(name: string, options?: DBOptions): DBHandle;
}

/**
 * Operations on a specific sub-database
 */
export interface DBHandle {
  // CRUD
  put(key: BinKey, value: BinVal): Operation<boolean>; // Return false if exists (no-overwrite)
  set(key: BinKey, value: BinVal): Operation<boolean>; // Overwrite allowed
  get(key: BinKey): Operation<BinVal | null>;
  del(key: BinKey): Operation<boolean>;

  // Iteration
  // Critical for KERI: Must support ordered iteration starting from a prefix
  cursor(options?: CursorOptions): Operation<DBCursor>;

  // Meta
  count(): Operation<number>;
  clear(): Operation<void>;
}

export interface CursorOptions {
  start?: BinKey; // Seek to this key
  reverse?: boolean;
}

export interface DBCursor {
  next(): Operation<{ key: BinKey; value: BinVal } | null>;
}
```

### 3. Implementation Strategy

#### A. Core (Shared)

Code in `src/core` and `src/keri` uses **only** the interfaces.

- `Baser` (the KERI DB manager) will accept a `DBBackend` in its constructor,
  not an `LMDBer` instance.
- `Baser` will no longer manage file paths directly; it will rely on the
  `DBBackend` implementation to handle persistence details.

#### B. Deno Server Implementation (`src/platform/deno`)

- **Storage**: `LMDBBackend` implementing `DBBackend`. Wrapper around `lmdb`
  package.
- **Platform**: `DenoPlatform` implementing `Platform`. Wrapper around `Deno.*`
  APIs.

#### C. Browser Implementation (`src/platform/browser`)

- **Storage**: `IndexedDBBackend` implementing `DBBackend`.
  - Mapping: `DBHandle` -> `IDBObjectStore`.
  - Ordering: IndexedDB supports cursor iteration naturally.
- **Platform**: `BrowserPlatform`.
  - `fs`: Throws errors or maps to a virtual FS (like OPFS - Origin Private File
    System) if strictly needed, but mostly unused since DB is IndexedDB.

### 4. Dependency Injection

The entry points determine which implementation is injected.

**Server Entry (`mod.ts` / CLI):**

```typescript
import { DenoPlatform } from "./platform/deno/Platform.ts";
import { LMDBBackend } from "./platform/deno/LMDBBackend.ts";
import { Agent } from "./app/agent.ts";

// Inject Deno-specifics
const platform = new DenoPlatform();
const db = new LMDBBackend({ path: "/var/keri/db" });
const agent = new Agent({ platform, db });

agent.start();
```

**Browser Entry (`index.browser.ts` - for NPM package):**

```typescript
import { BrowserPlatform } from "./platform/browser/Platform.ts";
import { IndexedDBBackend } from "./platform/browser/IndexedDBBackend.ts";

// Exports for library consumers
export * from "./core";
export { BrowserPlatform, IndexedDBBackend };

// Usage example
// const db = new IndexedDBBackend("keri_db");
// const client = new Client({ db });
```

## Migration Plan

1. **Define Interfaces**: Create `src/framework/storage.ts` and
   `src/framework/platform.ts`.
2. **Refactor `LMDBer`**: Rename current `LMDBer` to `LMDBBackend` and make it
   implement `DBBackend`.
3. **Refactor `Baser`**: Update `Baser` to depend on `DBBackend` interface,
   removing direct `LMDBer` dependency.
4. **Refactor `PathManager`**: Extract `Deno` calls into a `DenoPlatform` class.
5. **Update Entry Points**: Wire up the specific implementations in `cli.ts` and
   `server.ts`.

## Future Considerations

- **React Native**: Can implement `DBBackend` using SQLite or a native mobile DB
  wrapper.
- **Electron**: Can choose between `LMDBBackend` (Node main process) or
  `IndexedDBBackend` (Renderer process).
