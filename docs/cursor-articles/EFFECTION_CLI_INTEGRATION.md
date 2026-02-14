# Integrating Cliffy with Effection: Structured Concurrency

## Overview

Integrate Cliffy (promise-based CLI) with Effection (structured concurrency) so
**Effection is the outermost runtime**, matching KERIpy's Hio pattern.

## Core Pattern: Converting Promises to Operations

```typescript
function* toOp<T>(promise: Promise<T>): Operation<T> {
  return yield* action((resolve, reject) => {
    promise.then(resolve, reject);
    return () => {}; // Cleanup function
  });
}
```

**How it works**: `action()` creates an Effection operation that
resolves/rejects with the promise, allowing Effection to manage its lifecycle.

## Architecture: Effection as Outermost Runtime

```typescript
// mod.ts - Entry point
import { run } from "effection";
import { kli } from "./src/app/cli/cli.ts";

if (import.meta.main) {
  run(() => kli(Deno.args)).catch((error) => {
    console.error("Fatal error:", error);
    Deno.exit(1);
  });
}
```

**Key**: `run()` is the outermost runtime - everything happens inside Effection.

## CLI Structure: Two-Phase Execution

```typescript
export function* kli(args: string[] = []): Operation<void> {
  const context: CommandContext = {};
  const program = createCLIProgram(context);

  try {
    // Phase 1: Parse CLI arguments (promise-based Cliffy)
    yield* toOp(program.parse(args.length > 0 ? args : Deno.args));

    // Phase 2: Execute command operation (Effection-based)
    if (context.command && context.args) {
      const handler = commandHandlers.get(context.command);
      if (handler) {
        yield* handler(context.args);
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    throw error;
  }
}
```

**Execution flow**:

1. Parse phase: Cliffy's `parse()` returns a promise → convert to operation with
   `toOp`
2. Action handlers: Set `context.command` and `context.args`, return immediately
3. Execution phase: Execute Effection operation after parsing completes

## Command Handlers: Pure Effection Operations

```typescript
const commandHandlers: Map<
  string,
  (args: Record<string, unknown>) => Operation<void>
> = new Map([
  ["init", (args) => initCommand(args)],
  // ... other commands
]);
```

**Why**: Command handlers are pure Effection operations - composable,
cancellable, participate in structured concurrency.

## Comparison: Hio vs Effection

**KERIpy's Hio**:

```python
class DoDoer(Doer):
    def do(self):
        yield from self.enter()
        while not self.done:
            yield from self.recur()
        yield from self.exit()
```

**KERI TS's Effection**:

```typescript
function* operation(): Operation<void> {
  yield* enter();
  while (!done) {
    yield* recur();
  }
  yield* exit();
}
```

**Similarities**: Both use generators, hierarchical task trees, cancellation,
resource cleanup.

## Best Practices

1. **Always convert promises to operations**: Use `toOp()` to bridge async/await
   and Effection
2. **Use `yield*` for sequential operations**: Operations are composable
3. **Use `spawn()` for concurrent operations**: Structured concurrency handles
   cleanup
4. **Handle errors at the right level**: Errors propagate through the task tree
5. **Resources tied to operations**: Automatic cleanup on completion or
   cancellation

## Key Takeaways

- **Effection is the outermost runtime** - everything runs inside `run()`
- **Convert promises to operations** - use `toOp()` to bridge async/await and
  Effection
- **Two-phase execution** - parse with Cliffy, execute with Effection
- **Structured concurrency** - hierarchical task tree with automatic cleanup
- **Mirrors KERIpy's Hio** - same reliable concurrency patterns

This ensures KERI TS has the same reliable, structured concurrency as KERIpy.
