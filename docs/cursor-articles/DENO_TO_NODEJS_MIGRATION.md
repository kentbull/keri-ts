# Deno → Node.js Migration Assessment

## Summary

**Difficulty: MODERATE** - Most changes are straightforward API replacements,
but requires careful testing.

**Effection Compatibility: EXCELLENT** - Effection works identically in Node.js
since it's pure JavaScript.

**LMDB Compatibility: BETTER** - The `lmdb` npm package is designed for Node.js,
so the FFI panic issue should be resolved.

## Required Changes

### 1. File System Operations (PathManager)

**Deno → Node.js:**

```typescript
// Deno
await Deno.mkdir(path, { recursive: true, mode: perm });
await Deno.stat(path);
await Deno.remove(path, { recursive: true });

// Node.js
import { mkdir, rm, stat } from "fs/promises";
await mkdir(path, { recursive: true, mode: perm });
await stat(path);
await rm(path, { recursive: true });
```

**Files affected:** `src/db/core/path-manager.ts`

### 2. Environment Variables

**Deno → Node.js:**

```typescript
// Deno
Deno.env.get("HOME");
Deno.env.get("KERI_LMDB_MAP_SIZE");

// Node.js
process.env.HOME;
process.env.KERI_LMDB_MAP_SIZE;
```

**Files affected:**

- `src/db/core/path-manager.ts`
- `src/db/core/lmdber.ts`

### 3. Platform Detection

**Deno → Node.js:**

```typescript
// Deno
if (Deno.build.os === "darwin") { ... }

// Node.js
import { platform } from 'os';
if (platform() === "darwin") { ... }
// OR
if (process.platform === "darwin") { ... }
```

**Files affected:** `src/db/core/path-manager.ts`

### 4. CLI Arguments

**Deno → Node.js:**

```typescript
// Deno
kli(Deno.args);

// Node.js
kli(process.argv.slice(2));
```

**Files affected:** `mod.ts`, `src/app/cli/cli.ts`

### 5. Entry Point Detection

**Deno → Node.js:**

```typescript
// Deno
if (import.meta.main) { ... }

// Node.js (ES modules)
if (import.meta.url === `file://${process.argv[1]}`) { ... }
// OR use a different pattern
```

**Files affected:** `mod.ts`

### 6. Process Exit

**Deno → Node.js:**

```typescript
// Deno
Deno.exit(1);

// Node.js
process.exit(1);
```

**Files affected:** `mod.ts`

### 7. HTTP Server (if used)

**Deno → Node.js:**

```typescript
// Deno
const server = Deno.serve({ port, signal }, handler);

// Node.js
import { createServer } from "http";
const server = createServer(handler);
server.listen(port);
// Signal handling via process.on('SIGINT', ...)
```

**Files affected:** `src/app/server.ts`

### 8. Signal Handling

**Deno → Node.js:**

```typescript
// Deno
Deno.addSignalListener(signame, listener);
Deno.removeSignalListener(signame, listener);

// Node.js
process.on(signame, listener);
process.removeListener(signame, listener);
```

**Files affected:** `src/app/server.ts`

### 9. Package Management

**Deno → Node.js:**

- Remove `npm:` prefix from imports
- Create `package.json` with dependencies
- Add `"type": "module"` for ES modules
- Use `npm install` or `pnpm install`

**Example package.json:**

```json
{
  "name": "keri-ts",
  "version": "0.1.0",
  "type": "module",
  "main": "mod.js",
  "scripts": {
    "start": "node mod.js",
    "dev": "node --watch mod.js"
  },
  "dependencies": {
    "effection": "^3.6.0",
    "lmdb": "^3.4.2",
    "@cliffy/command": "^1.0.0-rc.8"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

## Migration Steps

1. **Create package.json** with dependencies
2. **Replace Deno APIs** with Node.js equivalents:
   - `fs/promises` for file operations
   - `process.env` for environment variables
   - `process.platform` for OS detection
   - `process.argv` for CLI args
   - `process.exit()` for exit
   - `process.on()` for signals
3. **Update imports** - remove `npm:` prefix
4. **Update entry point** - change `import.meta.main` check
5. **Test LMDB** - should work better in Node.js
6. **Update build/test scripts** - use Node.js instead of Deno

## Effection Compatibility

✅ **No changes needed** - Effection works identically:

- `action()` pattern works the same
- Generator functions work the same
- `yield*` works the same
- `run()` works the same

## Estimated Effort

- **File changes:** ~5-7 files
- **Time:** 2-4 hours for migration + testing
- **Risk:** Low - mostly mechanical replacements
- **Testing:** Need to verify LMDB works correctly

## Benefits

1. **LMDB compatibility** - Native Node.js support, should fix FFI panic
2. **Better ecosystem** - More npm packages available
3. **Better tooling** - More mature debugging/profiling tools
4. **Production ready** - Node.js is more battle-tested for production

## Potential Issues

1. **Signal handling** - Slightly different API
2. **File permissions** - Node.js uses different permission model (no explicit
   permissions needed)
3. **Path handling** - Should be similar, but test thoroughly
4. **Module resolution** - Need to ensure all imports resolve correctly

## Recommendation

**YES, migrate to Node.js** - The LMDB FFI panic is a blocker, and Node.js
should resolve it. The migration is straightforward and Effection compatibility
is excellent.
