import type { Operation } from "effection";
import { createTufaApp } from "../../../tufa/src/http/app.ts";
import type { ProtocolHostPolicy } from "../../src/app/protocol/protocol-host-policy.ts";
import type { AgentRuntime } from "../../src/app/runtime/agent-runtime.ts";
import type { RuntimeClock, RuntimeTimer } from "../../src/app/runtime/runtime-clock.ts";
import type { HttpRequestInit, HttpResponse, HttpStreamResponse } from "../../src/app/transport/http-client.ts";
import type { HttpClient } from "../../src/app/transport/http-client.ts";

import { httpClient } from "./http-client.ts";

interface ManualTimer {
  id: number;
  at: number;
  callback: () => void;
  cleared: boolean;
}

/** Deterministic clock for timeout-sensitive runtime tests. */
export class ManualRuntimeClock implements RuntimeClock {
  private currentMs: number;
  private nextId = 1;
  private readonly timers = new Map<number, ManualTimer>();

  constructor(startMs = 0) {
    this.currentMs = startMs;
  }

  now(): number {
    return this.currentMs;
  }

  setTimeout(callback: () => void, ms: number): RuntimeTimer {
    const id = this.nextId++;
    this.timers.set(id, {
      id,
      at: this.currentMs + Math.max(0, Math.floor(ms)),
      callback,
      cleared: false,
    });
    return id;
  }

  clearTimeout(timer: RuntimeTimer): void {
    if (typeof timer !== "number") {
      return;
    }
    const entry = this.timers.get(timer);
    if (entry) {
      entry.cleared = true;
      this.timers.delete(timer);
    }
  }

  advance(ms: number): void {
    this.currentMs += Math.max(0, Math.floor(ms));
    this.flushDue();
  }

  runAll(): void {
    while (this.timers.size > 0) {
      const next = [...this.timers.values()]
        .filter((timer) => !timer.cleared)
        .sort((left, right) => left.at - right.at || left.id - right.id)[0];
      if (!next) {
        return;
      }
      this.currentMs = Math.max(this.currentMs, next.at);
      this.flushDue();
    }
  }

  private flushDue(): void {
    while (true) {
      const due = [...this.timers.values()]
        .filter((timer) => !timer.cleared && timer.at <= this.currentMs)
        .sort((left, right) => left.at - right.at || left.id - right.id)[0];
      if (!due) {
        return;
      }
      this.timers.delete(due.id);
      due.callback();
    }
  }
}

export interface CapturedRuntimeRequest {
  url: string;
  method: string;
  request: Request;
}

type RuntimeHttpHandler = (request: Request) => Response | Promise<Response>;

/** Explicit fake HTTP client keyed by origin. */
export class FakeRuntimeHttpClient implements HttpClient {
  /** Actual requests admitted to configured in-process peers, in admission order. */
  readonly requests: CapturedRuntimeRequest[] = [];
  /** Deterministic HTTP peer handlers indexed by the requested origin. */
  private readonly handlers = new Map<string, RuntimeHttpHandler>();

  /** Bind one in-process peer without opening a socket. */
  registerOrigin(origin: string, handler: RuntimeHttpHandler): void {
    this.handlers.set(new URL(origin).origin, handler);
  }

  /** Consume a finite response through the deterministic HTTP peer. */
  request(url: string, init: HttpRequestInit = {}): Operation<HttpResponse> {
    return httpClient((url, init) => this.respond(url, init)).request(url, init);
  }

  /** Execute a configured peer through the same scoped request contract used by production. */
  open(url: string, init: HttpRequestInit = {}): Operation<HttpStreamResponse> {
    return httpClient((url, init) => this.respond(url, init)).open(url, init);
  }

  /** Record native request details before dispatching to the in-process peer. */
  private async respond(url: string, init: RequestInit = {}): Promise<Response> {
    const request = new Request(url, init);
    this.requests.push({
      url,
      method: request.method,
      request,
    });

    init.signal?.throwIfAborted();

    const origin = new URL(url).origin;
    const handler = this.handlers.get(origin);
    if (!handler) {
      return new Response("Not Found", { status: 404 });
    }
    return await handler(request);
  }
}

/** In-process Tufa runtime host registered under a fake HTTP origin. */
export class InProcessRuntimeHost {
  readonly origin: string;

  constructor(
    http: FakeRuntimeHttpClient,
    {
      runtime,
      protocolPolicy = {},
      origin = `http://runtime.test-${crypto.randomUUID()}`,
    }: {
      runtime?: AgentRuntime;
      protocolPolicy?: ProtocolHostPolicy;
      origin?: string;
    } = {},
  ) {
    this.origin = new URL(origin).origin;
    const app = createTufaApp({ runtime, protocolPolicy });
    http.registerOrigin(this.origin, (request) => app.fetch(request));
  }
}
