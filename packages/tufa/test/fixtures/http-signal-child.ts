/** Real HTTP child with a deterministic adapter-drain barrier controlled by stdin. */
import { run } from "effection";
import { startServer } from "../../src/host/http-server.ts";

const serve = Deno.serve;
let release!: () => void;
const drain = new Promise<void>((resolve) => release = resolve);
const wrappedServe = ((...args: Parameters<typeof Deno.serve>) => {
  const server = serve(...args);
  const finished = server.finished.then(async () => {
    console.log("DRAINING");
    await drain;
  });
  return new Proxy(server, {
    get(target, key) {
      if (key === "finished") return finished;
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}) as typeof Deno.serve;
// Deno 2.8 exposes a configurable getter without the setter added in 2.9.
Object.defineProperty(Deno, "serve", { configurable: true, value: wrappedServe });
const quiet = {
  debug() {},
  info(message: string) {
    if (message === "Shutting down server...") console.log("SIGNAL");
  },
  warn() {},
  error() {},
};
const task = run(() =>
  startServer(0, quiet, undefined, {
    onListen() {
      console.log("READY");
    },
  })
);
const input = new Uint8Array(1);
await Deno.stdin.read(input);
const halted = task.halt().then(() => console.log("HALTED"));
await Deno.stdin.read(input);
release();
await halted;
console.log("DONE");
