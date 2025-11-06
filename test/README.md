# KERI-ts CLI Test Suite

This directory contains comprehensive tests for the KERI-ts CLI implementation, built on top of Deno's testing framework and Effection primitives for structured concurrency.

## Test Structure

```
test/
├── utils.ts                    # Test utilities and helpers
├── config.test.ts             # Test configuration and setup
├── runner.ts                  # Custom test runner
├── unit/
│   └── cli.test.ts           # Unit tests for CLI components
└── integration/
    ├── effection.test.ts      # Integration tests using Effection primitives
    └── main.test.ts          # Integration tests for main CLI entry point
```

## Test Categories

### Unit Tests (`test/unit/`)
- CLI argument parsing and validation
- Command logic and error handling
- Individual component functionality
- Mock data and test utilities

### Integration Tests (`test/integration/`)
- Full CLI command execution
- Effection primitive usage (`run`, `spawn`, `Operation`)
- System simulation and resource management
- Error propagation and cleanup
- Concurrent command execution

## Running Tests

### Basic Commands
```bash
# Run all tests
deno task test

# Run only unit tests
deno task test:unit

# Run only integration tests
deno task test:integration

# Run tests in watch mode
deno task test:watch

# Run tests with coverage
deno task test:coverage

# Generate coverage report
deno task coverage
```

### Advanced Usage
```bash
# Run specific test file
deno test test/unit/cli.test.ts

# Run tests with verbose output
deno task test --verbose

# Run tests with custom patterns
deno test test/integration/ --allow-sys --allow-net --allow-env --allow-read --allow-write
```

## Test Utilities

### CLITestHarness
Captures console output for testing CLI commands:
```typescript
const harness = new CLITestHarness();
harness.captureOutput();
// ... run CLI command
harness.assertOutputContains('Expected output');
harness.restoreOutput();
```

### Effection Integration
Tests use Effection primitives for structured concurrency:
```typescript
const result = await run(() => testCLICommand(() => initCommand(args), args));
```

### Mock Utilities
- `createMockArgs()` - Create mock CLI arguments
- `testCLICommand()` - Test CLI command execution
- `testConcurrentCLICommands()` - Test multiple commands concurrently
- `assertOperationThrows()` - Assert operation throws expected error

## Test Features

### Effection Primitive Testing
- **`run()`** - Execute operations with proper error handling
- **`spawn()`** - Test concurrent command execution
- **`timeout()`** - Test command timeouts and cancellation
- **Resource Management** - Test proper cleanup and resource handling

### System Simulation
- Full CLI command execution
- Concurrent command testing
- Error propagation and handling
- Resource cleanup verification
- Timeout and cancellation testing

### Coverage
- Line coverage reporting
- Branch coverage analysis
- HTML coverage reports
- Integration with Deno's built-in coverage tools

## Test Examples

### Unit Test Example
```typescript
Deno.test("CLI: init command with valid arguments", async () => {
  const args = createMockArgs({
    name: 'testkeystore',
    nopasscode: true,
  });

  await run(() => initCommand(args));
  // Test passes if no exception is thrown
});
```

### Integration Test Example
```typescript
Deno.test("Integration: Multiple CLI commands with spawn", async () => {
  const commands = [
    { name: 'init1', command: () => initCommand(args1), args: args1 },
    { name: 'init2', command: () => initCommand(args2), args: args2 },
  ];

  const results = await run(() => testConcurrentCLICommands(commands));
  assertEquals(Object.keys(results).length, 2);
});
```

## Best Practices

1. **Use Effection Primitives**: All tests should use `run()`, `spawn()`, and `Operation<T>` for proper structured concurrency
2. **Test Resource Cleanup**: Always verify that resources are properly cleaned up
3. **Mock External Dependencies**: Use test utilities to mock console output and CLI arguments
4. **Test Error Cases**: Include tests for error conditions and edge cases
5. **Concurrent Testing**: Test multiple commands running concurrently using `spawn()`
6. **Coverage Goals**: Aim for high test coverage, especially for critical CLI functionality

## Dependencies

- **Deno Testing Framework** - Built-in testing capabilities
- **@std/testing** - Deno standard library testing utilities
- **@std/assert** - Assertion utilities
- **Effection** - Structured concurrency primitives
- **@std/cli** - CLI argument parsing

## Future Enhancements

- Performance testing with large datasets
- Memory leak detection
- Stress testing with concurrent operations
- Integration with external KERI components
- Automated test generation
- Continuous integration setup
