# Integrating Cliffy with Effection: Structured Concurrency in Deno

## Overview

This document explains how we integrated Cliffy (a promise-based CLI framework) with Effection (a structured concurrency framework) to create a CLI where **Effection is the outermost runtime**, not JavaScript's event loop. This pattern is critical for KERI TS because it mirrors the structured concurrency approach used in KERIpy's Hio framework.

## Core Concepts

### 1. The Problem: Two Different Concurrency Models

**JavaScript's Event Loop (async/await):**
- Uses promises and async/await
- No structured lifecycle management
- Difficult to cancel or clean up
- Errors can be lost or unhandled
- No hierarchical task management

**Effection's Structured Concurrency:**
- Uses generator functions (`function*`) and operations (`Operation<T>`)
- Hierarchical task tree with automatic cleanup
- Cancellation propagates through the tree
- Errors are properly scoped and handled
- Resources are automatically cleaned up when tasks complete or are cancelled

### 2. The Bridge: Converting Promises to Operations

The key to integrating promise-based APIs (like Cliffy) with Effection is the `toOp` helper:

```typescript
function* toOp<T>(promise: Promise<T>): Operation<T> {
  return yield* action((resolve, reject) => {
    promise.then(resolve, reject);
    return () => {}; // Cleanup function (can add abort logic if needed)
  });
}
```

**How it works:**
1. `action()` creates an Effection operation that can resolve or reject
2. We attach the promise's `.then()` to Effection's resolve/reject callbacks
3. The cleanup function (`() => {}`) is called when the operation is cancelled
4. This allows Effection to manage the promise's lifecycle

**Why this matters:**
- Effection can now cancel promises by calling the cleanup function
- The promise becomes part of Effection's task tree
- Errors from the promise propagate through Effection's error handling
- The operation can be composed with other Effection operations using `yield*`

### 3. The Architecture: Effection as Outermost Runtime

```typescript
// mod.ts - Entry point
import { run } from 'effection';
import { kli } from './cli.ts';

if (import.meta.main) {
  run(() => kli(Deno.args)).catch((error) => {
    console.error('Fatal error:', error);
    Deno.exit(1);
  });
}
```

**Key points:**
- `run()` is the **outermost** runtime - everything happens inside Effection
- `kli()` returns an `Operation<void>`, not a `Promise<void>`
- All execution flows through Effection's structured concurrency system

### 4. The CLI Structure: Command Execution Pattern

```typescript
export function* kli(args: string[] = []): Operation<void> {
  const context: CommandContext = {};
  const program = createCLIProgram(context);
  
  try {
    // Step 1: Parse CLI arguments (promise-based Cliffy)
    yield* toOp(program.parse(args.length > 0 ? args : Deno.args));
    
    // Step 2: Execute command operation (Effection-based)
    if (context.command && context.args) {
      const handler = commandHandlers.get(context.command);
      if (handler) {
        yield* handler(context.args);
      }
    }
  } catch (error: unknown) {
    // Errors propagate through Effection's structured error handling
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    throw error;
  }
}
```

**Execution flow:**
1. **Parse phase**: Cliffy's `parse()` returns a promise, which we convert to an operation using `toOp`
2. **Action handlers**: Cliffy's action handlers set `context.command` and `context.args`, then return immediately
3. **Execution phase**: After parsing completes, we execute the appropriate Effection operation
4. **Error handling**: Errors propagate through Effection's structured concurrency system

### 5. Command Handlers: Pure Effection Operations

```typescript
const commandHandlers: Map<string, (args: Record<string, unknown>) => Operation<void>> = new Map([
  ['init', (args: Record<string, unknown>) => initCommand(args)],
  // ... other commands
]);
```

**Why this pattern:**
- Command handlers are **pure Effection operations**
- They can be composed, cancelled, and managed by Effection
- They participate in Effection's structured concurrency
- They can spawn child tasks, manage resources, and handle errors properly

## Deep Dive: How Structured Concurrency Works

### Task Hierarchy

In Effection, operations form a tree:

```
run() (root)
  └─ kli() operation
      ├─ toOp(parse()) - Cliffy parsing
      └─ initCommand() - Command execution
          └─ (nested operations)
```

**Benefits:**
- If `kli()` is cancelled, all child operations are automatically cancelled
- Resources are cleaned up in reverse order (children first, then parents)
- Errors bubble up through the tree
- You can spawn concurrent tasks that are automatically managed

### Resource Management

```typescript
function* initCommand(args: Record<string, unknown>): Operation<void> {
  // Resources acquired here are automatically cleaned up
  // when the operation completes or is cancelled
  
  const keystore = yield* openKeystore(args.name);
  try {
    // Use keystore
    yield* createDatabase(keystore);
  } finally {
    // Cleanup happens automatically via Effection
    // But you can also add explicit cleanup here
  }
}
```

**Key insight:** In Effection, resources are tied to the operation's lifecycle. When an operation completes or is cancelled, all its resources are automatically cleaned up.

### Error Propagation

```typescript
function* kli(args: string[]): Operation<void> {
  try {
    yield* toOp(program.parse(args));
    yield* handler(context.args);
  } catch (error) {
    // This catches errors from:
    // - Cliffy parsing errors
    // - Command execution errors
    // - Any nested operation errors
    throw error; // Re-throw so Effection can handle it
  }
}
```

**Structured error handling:**
- Errors propagate up the task tree
- Each level can catch, transform, or re-throw errors
- Cancellation signals also propagate through the tree
- No lost errors or unhandled promise rejections

## Comparison: Hio (KERIpy) vs Effection (KERI TS)

### KERIpy's Hio Framework

```python
class DoDoer(Doer):
    def do(self):
        # Generator-based structured concurrency
        yield from self.enter()
        while not self.done:
            yield from self.recur()
        yield from self.exit()
```

**Characteristics:**
- Generator-based (`yield from`)
- Hierarchical doer tree
- Explicit lifecycle methods (enter, recur, exit)
- Time-based scheduling (tyme, tock)

### KERI TS's Effection

```typescript
function* operation(): Operation<void> {
  yield* enter();
  while (!done) {
    yield* recur();
  }
  yield* exit();
}
```

**Characteristics:**
- Generator-based (`yield*`)
- Hierarchical operation tree
- Implicit lifecycle (via try/finally)
- Event-based scheduling (promises, signals)

**Key Similarities:**
- Both use generators for structured concurrency
- Both have hierarchical task trees
- Both support cancellation and cleanup
- Both manage resources tied to task lifecycle

## Best Practices for Integrating Async/Await with Effection

### 1. Always Convert Promises to Operations

```typescript
// ❌ Bad: Mixing promises and operations
async function badExample() {
  const result = await somePromise();
  yield* someOperation(); // Can't mix!
}

// ✅ Good: Convert promises to operations
function* goodExample(): Operation<void> {
  const result = yield* toOp(somePromise());
  yield* someOperation(); // All operations!
}
```

### 2. Use `yield*` for Sequential Operations

```typescript
function* sequential(): Operation<void> {
  yield* step1(); // Wait for step1 to complete
  yield* step2(); // Then execute step2
  yield* step3(); // Then execute step3
}
```

### 3. Use `spawn()` for Concurrent Operations

```typescript
function* concurrent(): Operation<void> {
  const task1 = spawn(() => operation1());
  const task2 = spawn(() => operation2());
  
  // Both run concurrently
  const result1 = yield* task1; // Wait for task1
  const result2 = yield* task2; // Wait for task2
  
  // If task1 fails, task2 is automatically cancelled
}
```

### 4. Handle Errors at the Right Level

```typescript
function* withErrorHandling(): Operation<void> {
  try {
    yield* riskyOperation();
  } catch (error) {
    // Handle error at this level
    yield* cleanup();
    throw error; // Re-throw to propagate
  }
}
```

### 5. Use Resources for Cleanup

```typescript
function* withResource(): Operation<void> {
  const resource = yield* acquireResource();
  try {
    yield* useResource(resource);
  } finally {
    yield* releaseResource(resource);
  }
}
```

## Why This Matters for KERI TS

### 1. Mirroring KERIpy's Architecture

KERIpy uses Hio's structured concurrency for:
- Managing long-running operations (witness servers, watchers)
- Coordinating multiple concurrent tasks
- Proper resource cleanup
- Error handling and recovery

KERI TS needs the same capabilities, and Effection provides them.

### 2. Reliable Resource Management

KERI operations often involve:
- Database connections
- Network connections
- File handles
- Cryptographic operations

Effection ensures these are always cleaned up, even if operations are cancelled or fail.

### 3. Composable Operations

KERI operations are often composed of smaller operations:
- Creating an identifier involves multiple steps
- Rotating keys involves coordination
- Witness operations involve multiple concurrent tasks

Effection's structured concurrency makes composition natural and safe.

### 4. Testability

Effection operations are easy to test:
- You can run operations in tests using `run()`
- You can spawn operations concurrently
- You can cancel operations to test cleanup
- Errors are properly scoped

## Example: Complete Command Execution Flow

```typescript
// 1. Entry point - Effection is outermost runtime
run(() => kli(Deno.args))

// 2. CLI operation - runs in Effection
function* kli(args: string[]): Operation<void> {
  // 3. Convert Cliffy's promise to Effection operation
  yield* toOp(program.parse(args));
  
  // 4. Execute command as Effection operation
  yield* initCommand(args);
}

// 5. Command operation - pure Effection
function* initCommand(args: Record<string, unknown>): Operation<void> {
  // 6. All operations use yield*, not await
  const keystore = yield* openKeystore(args.name);
  const db = yield* openDatabase(args.name);
  
  try {
    yield* createKeystore(keystore);
    yield* createDatabase(db);
  } finally {
    // 7. Cleanup happens automatically, but can be explicit
    yield* closeKeystore(keystore);
    yield* closeDatabase(db);
  }
}
```

## Key Takeaways

1. **Effection is the outermost runtime** - everything runs inside `run()`
2. **Convert promises to operations** - use `toOp()` to bridge async/await and Effection
3. **Use `yield*` for sequential operations** - operations are composable
4. **Use `spawn()` for concurrent operations** - structured concurrency handles cleanup
5. **Errors propagate through the tree** - structured error handling
6. **Resources are tied to operations** - automatic cleanup on completion or cancellation

This architecture ensures that KERI TS has the same reliable, structured concurrency as KERIpy, making it suitable for production use in distributed systems where proper resource management and error handling are critical.

