import { type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { startServer } from "../server.ts";

interface AgentArgs {
  port?: number;
}

/**
 * Agent command operation - starts the HTTP server
 *
 * @param args - Command arguments including optional port
 * @returns Operation that runs the server until shutdown
 */
export function* agentCommand(args: Record<string, unknown>): Operation<void> {
  // Extract port from args (default to 8000)
  const port = args.port ? Number(args.port) : 8000;

  // Validate port number
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new ValidationError(
      `Invalid port number: ${port}. Port must be between 1 and 65535.`,
      { port },
    );
  }

  // Start the server (this operation will run until shutdown)
  console.log(`Starting server on port ${port}`);
  yield* startServer(port);
}
