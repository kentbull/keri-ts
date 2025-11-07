import { assertEquals, assertRejects } from "jsr:@std/assert@^1.0.15";
import { type Operation, run, spawn } from 'npm:effection@3.6.0';

/**
 * Test utilities for CLI testing with Effection
 */
export class CLITestHarness {
  private capturedOutput: string[] = [];
  private capturedErrors: string[] = [];
  private originalConsoleLog: typeof console.log;
  private originalConsoleError: typeof console.error;

  constructor() {
    this.originalConsoleLog = console.log;
    this.originalConsoleError = console.error;
  }

  /**
   * Capture console output for testing
   */
  captureOutput(): void {
    console.log = (...args: unknown[]) => {
      this.capturedOutput.push(args.map(String).join(' '));
    };
    console.error = (...args: unknown[]) => {
      this.capturedErrors.push(args.map(String).join(' '));
    };
  }

  /**
   * Restore original console functions
   */
  restoreOutput(): void {
    console.log = this.originalConsoleLog;
    console.error = this.originalConsoleError;
  }

  /**
   * Get captured output
   */
  getOutput(): string[] {
    return [...this.capturedOutput];
  }

  /**
   * Get captured errors
   */
  getErrors(): string[] {
    return [...this.capturedErrors];
  }

  /**
   * Clear captured output
   */
  clearOutput(): void {
    this.capturedOutput = [];
    this.capturedErrors = [];
  }

  /**
   * Assert output contains expected text
   */
  assertOutputContains(expected: string): void {
    const output = this.capturedOutput.join('\n');
    assertEquals(output.includes(expected), true, `Expected output to contain "${expected}", but got: ${output}`);
  }

  /**
   * Assert error contains expected text
   */
  assertErrorContains(expected: string): void {
    const errors = this.capturedErrors.join('\n');
    assertEquals(errors.includes(expected), true, `Expected errors to contain "${expected}", but got: ${errors}`);
  }
}

/**
 * Mock CLI arguments for testing
 */
export interface MockCLIArgs {
  command?: string;
  help?: boolean;
  version?: boolean;
  name?: string;
  base?: string;
  temp?: boolean;
  salt?: string;
  configDir?: string;
  configFile?: string;
  passcode?: string;
  aeid?: string;
  seed?: string;
  nopasscode?: boolean;
  [key: string]: unknown;
}

/**
 * Create mock CLI arguments
 */
export function createMockArgs(args: MockCLIArgs = {}): Record<string, unknown> {
  return {
    command: 'init',
    help: false,
    version: false,
    name: 'testkeystore',
    base: '',
    temp: false,
    salt: '',
    configDir: '',
    configFile: '',
    passcode: '',
    aeid: '',
    seed: '',
    nopasscode: false,
    ...args,
  };
}

/**
 * Test operation that simulates CLI command execution
 */
export function* testCLICommand(
  command: Operation<void>,
  _args: MockCLIArgs = {}
): Operation<{ output: string[]; errors: string[] }> {
  const harness = new CLITestHarness();
  
  try {
    harness.captureOutput();
    
    // Note: Deno.args is read-only, so we can't mock it directly
    // In a real test, you'd need to modify the command to accept args as a parameter
    
    yield* command;
    
    return {
      output: harness.getOutput(),
      errors: harness.getErrors(),
    };
  } finally {
    harness.restoreOutput();
  }
}

/**
 * Test operation that runs multiple CLI commands concurrently
 */
export function* testConcurrentCLICommands(
  commands: Array<{ name: string; command: Operation<void>; args: MockCLIArgs }>
): Operation<Record<string, { output: string[]; errors: string[] }>> {
  const results: Record<string, { output: string[]; errors: string[] }> = {};
  
  // Spawn all commands concurrently
  const tasks = commands.map(({ name, command, args }) =>
    spawn(function* () {
      const result = yield* testCLICommand(command, args);
      results[name] = result;
    })
  );
  
  // Wait for all commands to complete
  for (const task of tasks) {
    yield* task;
  }
  
  return results;
}

/**
 * Assert that an operation throws with expected error message
 */
export async function assertOperationThrows(
  operation: Operation<void>,
  expectedError: string
): Promise<void> {
  await assertRejects(
    async () => {
      await run(() => operation);
    },
    Error,
    expectedError
  );
}

/**
 * Test helper for simulating user input
 */
export class MockInput {
  private inputs: string[] = [];
  private currentIndex = 0;

  constructor(inputs: string[] = []) {
    this.inputs = inputs;
  }

  addInput(input: string): void {
    this.inputs.push(input);
  }

  getNextInput(): string | undefined {
    return this.inputs[this.currentIndex++];
  }

  hasMoreInputs(): boolean {
    return this.currentIndex < this.inputs.length;
  }
}

/**
 * Mock prompt function for testing
 */
export function createMockPrompt(mockInput: MockInput): typeof prompt {
  return (_message?: string): string | null => {
    return mockInput.getNextInput() || null;
  };
}
