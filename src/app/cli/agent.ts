import { type Operation } from 'npm:effection@3.6.0';
import { startServer } from './src/app/server.ts';

interface AgentArgs {
  port?: number;
  help?: boolean;
}

function printAgentHelp() {
  console.log(`
kli agent - Start the KERI agent server

Usage: kli agent [options]

Options:
  --port, -p <port>           Port number for the server (default: 8000)
  --help, -h                  Show this help message

The agent server provides HTTP endpoints for interacting with keri-ts.
The server will run until interrupted with SIGINT (Ctrl+C).
`);
}

/**
 * Agent command operation - starts the HTTP server
 * 
 * @param args - Command arguments including optional port
 * @returns Operation that runs the server until shutdown
 */
export function* agentCommand(args: Record<string, unknown>): Operation<void> {
  // Check for help flag
  if (args.help || args.h) {
    printAgentHelp();
    return;
  }

  // Extract port from args (default to 8000)
  const port = args.port ? Number(args.port) : 8000;

  // Validate port number
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port number: ${port}. Port must be between 1 and 65535.`);
  }

  // Start the server (this operation will run until shutdown)
  yield* startServer(port);
}

