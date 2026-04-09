import type { AgentRuntime } from "../agent-runtime.ts";
import type { Hab } from "../habbing.ts";
import type { HostedRouteResolution } from "../mailboxing.ts";
import type { RuntimeServerOptions } from "../server.ts";

/** Shared request handler contract consumed by both Deno and Node hosts. */
export type ProtocolHandler = (req: Request) => Promise<Response>;

/** One parsed OOBI route request. */
export interface OobiRouteRequest {
  kind: "wellKnown" | "oobi";
  aid: string | null;
  role?: string;
  eid?: string;
}

/** One request snapshot used by path-first route classification. */
export interface ProtocolRequestContext {
  readonly req: Request;
  readonly url: URL;
  readonly pathname: string;
  readonly method: string;
  readonly runtime?: AgentRuntime;
  readonly options: RuntimeServerOptions;
  readonly hosted: HostedRouteResolution | null;
  readonly mailboxAdmin: HostedRouteResolution | null;
  readonly genericIngress: HostedRouteResolution | null;
  readonly oobi: OobiRouteRequest | null;
}

/** Path-level route decision before any request body is read. */
export type ProtocolRoute =
  | { kind: "health" }
  | { kind: "mailboxAdmin"; mailboxAid: string }
  | { kind: "witnessReceiptsPost"; witnessHab: Hab }
  | { kind: "witnessReceiptsGet"; witnessHab: Hab }
  | { kind: "witnessQueryGet"; witnessHab: Hab }
  | { kind: "oobi"; request: OobiRouteRequest }
  | { kind: "genericCesrIngress"; hosted: HostedRouteResolution }
  | { kind: "ambiguousHostedPath"; message: string }
  | { kind: "notFound" };

/** Body-aware ingress decision for one already-inspected CESR request. */
export type CesrIngressRoute =
  | { kind: "witnessLocalIngress"; witnessHab: Hab }
  | { kind: "runtimeIngress"; mailboxAid: string | null }
  | {
    kind: "mailboxQueryStream";
    mailboxAid: string | null;
    pre: string | null;
    topics: unknown;
  }
  | {
    kind: "runtimeIngressWithKsnReplay";
    mailboxAid: string | null;
    pre: string | null;
  };
