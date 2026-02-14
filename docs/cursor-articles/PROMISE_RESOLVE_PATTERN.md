# Why `Promise.resolve()` in Cliffy Action Handlers?

## The Pattern: Two-Phase Execution

We use a **two-phase execution pattern** that bridges Cliffy (promise-based)
with Effection (operation-based):

```typescript
.action((options) => {
  // Phase 1: Synchronous setup (happens immediately)
  context.command = 'init';
  context.args = { ...options };
  
  // Return immediately resolved promise
  return Promise.resolve();
})

// Phase 2: Actual execution (happens in Effection)
yield* toOp(program.parse(args));
if (context.command) {
  yield* handler(context.args); // Effection operation
}
```

## Why `Promise.resolve()`?

### 1. Cliffy's Expectation

Cliffy's `parse()` **awaits** the promise returned by action handlers:

```typescript
// Cliffy internally does:
async function parse(args: string[]) {
  const command = findCommand(args);
  const result = await command.action(options); // Waits for promise!
  return result;
}
```

**Key insight**: Cliffy expects action handlers to return promises (allows async
handlers).

### 2. Our Workaround Pattern

We're **not** using async/await in action handlers because we want Effection to
manage concurrency:

- **Action handlers**: Synchronous setup only (set context)
- **Return**: `Promise.resolve()` to satisfy Cliffy's expectation
- **Actual work**: Happens later in Effection operations

### 3. Why Not Execute in Action Handler?

**Problems with executing Effection operations in action handlers**:

- ❌ Creates nested Effection contexts (`run()` inside `run()`)
- ❌ Breaks structured concurrency (two separate trees)
- ❌ Can't properly cancel or manage lifecycle
- ❌ Errors don't propagate correctly

### 4. The Correct Pattern: Deferred Execution

```typescript
// Phase 1: Cliffy parsing (synchronous setup)
.action((options) => {
  context.command = 'init';
  context.args = options;
  return Promise.resolve(); // "Setup complete, ready for execution"
})

// Phase 2: Effection execution (structured concurrency)
yield* toOp(program.parse(args)); // Parse completes immediately
yield* handler(context.args);      // Execute in Effection context
```

**Benefits**:

- ✅ Single Effection context (no nesting)
- ✅ Proper structured concurrency
- ✅ Errors propagate correctly
- ✅ Can be cancelled properly

## Is This a Cliffy Pattern?

**No, this is a hybrid workaround pattern**, not a Cliffy best practice.

**Normal Cliffy Pattern**:

```typescript
.action(async (options) => {
  await createKeystore(options.name);
  await createDatabase(options.name);
})
await program.parse(args); // Everything happens here
```

**Our Pattern (Cliffy + Effection)**:

```typescript
.action((options) => {
  context.command = 'init';
  context.args = options;
  return Promise.resolve(); // "Ready, but not executing yet"
})
yield* toOp(program.parse(args)); // Parse completes
yield* handler(context.args);      // Execute in Effection
```

## Design Rationale

1. **Separation of Concerns**: Cliffy handles parsing, Effection handles
   execution
2. **Structured Concurrency**: All execution in single Effection context
3. **Type Safety**: Satisfies Cliffy's promise expectation
4. **Future-Proof**: Easy to add new commands

## Key Insight

`Promise.resolve()` is **not** a Cliffy pattern - it's our **bridge pattern**:

> **We're not executing in the action handler - we're just signaling what to
> execute later.**

This ensures **Effection remains the outermost runtime**, maintaining proper
structured concurrency while leveraging Cliffy's CLI parsing.
