import type { Operation } from "effection";
import { createTufaApp } from "../../../tufa/src/http/app.ts";
import type { AgentRuntime } from "../../src/app/agent-runtime.ts";
import type {
  MailboxFetchTimeoutPolicy,
  MailboxPollTransport,
  MailboxPollTransportRequest,
} from "../../src/app/forwarding.ts";
import type { MailboxSseMessage } from "../../src/app/mailbox-sse.ts";
import type { ProtocolHostPolicy } from "../../src/app/protocol-host-policy.ts";
import type {
  RuntimeClock,
  RuntimeHttpClient,
  RuntimeServices,
  RuntimeTimer,
} from "../../src/app/runtime-services.ts";
import { runtimeTurn } from "../../src/app/runtime-turn.ts";

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
export class FakeRuntimeHttpClient implements RuntimeHttpClient {
  readonly requests: CapturedRuntimeRequest[] = [];
  private readonly handlers = new Map<string, RuntimeHttpHandler>();

  registerOrigin(origin: string, handler: RuntimeHttpHandler): void {
    this.handlers.set(new URL(origin).origin, handler);
  }

  async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const request = new Request(url, init);
    this.requests.push({
      url,
      method: request.method,
      request,
    });

    if (init.signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    const origin = new URL(url).origin;
    const handler = this.handlers.get(origin);
    if (!handler) {
      return new Response("Not Found", { status: 404 });
    }
    return await handler(request);
  }
}

export interface FakeMailboxPollResult {
  messages?: MailboxSseMessage[];
  advanceMs?: number;
}

export interface CapturedMailboxPoll {
  endpoint: { eid: string; url: string };
  topics: Record<string, number>;
  timeouts: MailboxFetchTimeoutPolicy;
}

/** Deterministic mailbox poll transport for poller budget/cursor tests. */
export class FakeMailboxPollTransport implements MailboxPollTransport {
  readonly polls: CapturedMailboxPoll[] = [];
  private readonly results: FakeMailboxPollResult[];

  constructor(
    results: FakeMailboxPollResult[] = [],
    private readonly clock?: ManualRuntimeClock,
  ) {
    this.results = [...results];
  }

  enqueue(result: FakeMailboxPollResult): void {
    this.results.push(result);
  }

  *poll(args: MailboxPollTransportRequest): Operation<MailboxSseMessage[]> {
    this.polls.push({
      endpoint: { ...args.endpoint },
      topics: { ...args.topics },
      timeouts: { ...args.timeouts },
    });
    const result = this.results.shift() ?? {};
    if (result.advanceMs !== undefined) {
      this.clock?.advance(result.advanceMs);
    }
    yield* runtimeTurn();
    return result.messages ?? [];
  }
}

export function fakeRuntimeServices(
  {
    clock = new ManualRuntimeClock(),
    http = new FakeRuntimeHttpClient(),
  }: {
    clock?: ManualRuntimeClock;
    http?: FakeRuntimeHttpClient;
  } = {},
): RuntimeServices {
  return { clock, http };
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
