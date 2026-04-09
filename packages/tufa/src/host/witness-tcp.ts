import { concatBytes } from "cesr-ts";
import { action, type Operation } from "effection";
import { type AgentRuntime, type Hab, processWitnessIngress } from "keri-ts/runtime";
import { createServer, type Server, type Socket } from "node:net";

interface RunningWitnessTcpServer {
  readonly finished: Promise<void>;
  close(): void;
}

/** Read the whole inbound TCP payload before handing it to the runtime. */
async function readSocketBytes(socket: Socket): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  await new Promise<void>((resolve, reject) => {
    socket.on("data", (chunk) => {
      chunks.push(new Uint8Array(chunk));
    });
    socket.once("end", resolve);
    socket.once("error", reject);
    socket.once("close", () => resolve());
  });
  return chunks.length === 0 ? new Uint8Array() : concatBytes(...chunks);
}

/** Process one accepted TCP witness connection through witness-local ingress. */
async function handleWitnessSocket(
  socket: Socket,
  runtime: AgentRuntime,
  serviceHab: Hab,
): Promise<void> {
  try {
    const bytes = await readSocketBytes(socket);
    if (bytes.length > 0) {
      processWitnessIngress(runtime, serviceHab, bytes, { local: true });
    }
  } finally {
    socket.destroy();
  }
}

/** Open one raw TCP witness ingress host. */
function openWitnessTcpServer(
  port: number,
  hostname: string,
  runtime: AgentRuntime,
  serviceHab: Hab,
): RunningWitnessTcpServer {
  const server: Server = createServer((socket) => {
    void handleWitnessSocket(socket, runtime, serviceHab).catch(() => {
      socket.destroy();
    });
  });

  const finished = new Promise<void>((resolve, reject) => {
    server.once("close", resolve);
    server.once("error", reject);
  });
  server.listen(port, hostname);

  return {
    finished,
    close() {
      if (server.listening) {
        server.close();
      }
    },
  };
}

/** Adapt the TCP server promise lifecycle into an Effection operation. */
export function* startWitnessTcpServer(
  port: number,
  hostname: string,
  runtime: AgentRuntime,
  serviceHab: Hab,
): Operation<void> {
  const server = openWitnessTcpServer(port, hostname, runtime, serviceHab);
  try {
    yield* action((resolve, reject) => {
      server.finished.then(resolve).catch(reject);
      return () => {};
    });
  } finally {
    server.close();
  }
}
