/** Signed service routes over the shared public KEL/TEL acceptance owner. */
import type { ProtocolHandler } from "@keri-ts/hosting";
import { b, type CesrFrame, concatBytes, parseBytes, ParserError, SerderACDC, SerderKERI } from "cesr-ts";
import { run } from "effection";
import type { RegistryStore } from "keri-ts/db";
import {
  CESR_CONTENT_TYPE,
  envelopeFromFrame,
  isCesrContentType,
  Kramer,
  type ProtocolProcessor,
  readCesrRequestBytes,
} from "keri-ts/runtime";

/** Service role allowlists and response profile; authentication remains KRAM's responsibility. */
export interface RegistrarOptions {
  publishers?: readonly string[];
  observers?: readonly string[];
  /** Include controller/delegation KEL and framed TEL/public openings instead of bare TEL. */
  fullEvidence?: boolean;
}
/** Request-local final native outcomes; no application pending queue or acceptance records. */
export interface PublicationResult {
  accepted: Record<string, number>;
  pending: Record<string, number>;
  rejected: Record<string, number | string>;
  heads: Record<string, string>;
}
/** A SAD object excludes arrays and scalar representations. */
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Ordinary service errors carry no evidence or observation claims. */
function text(message: string, status: number): Response {
  return new Response(message, { status, headers: { "Content-Type": "text/plain" } });
}
/** Interpret the existing bulk registry selector; an absent selector means all accepted heads. */
function registryScope(value: unknown, store: RegistryStore): string[] | null {
  if (value === undefined || value === null || value === "") {
    return [...store.baser.heads.getTopItemIter()].map(([keys]) => keys[0]).sort();
  }
  if (typeof value === "string") return [value];
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0)
    ? value
    : null;
}
/** Query ordinals remain exact safe storage integers; strings retain hexadecimal TEL syntax. */
function ordinal(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== "string" || !/^[0-9a-f]+$/.test(value)) return null;
  const sn = BigInt(`0x${value}`);
  return sn <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(sn) : null;
}

/**
 * Host foreign public evidence without issuer keys or a second validation path.
 * The caller owns processor/store lifetime, enabled non-exempt KRAM and network hosting.
 * Selected Python reference: kf-registrar 7e934668, declared KERIpy 7ea525ba.
 */
export class Registrar {
  private readonly publishers: ReadonlySet<string>;
  private readonly observers: ReadonlySet<string>;
  private readonly fullEvidence: boolean;

  constructor(readonly processor: ProtocolProcessor, readonly store: RegistryStore, options: RegistrarOptions = {}) {
    if (processor.registry?.store !== store) {
      throw new TypeError("Registrar requires its processor's actual registry store.");
    }
    this.publishers = new Set(options.publishers);
    this.observers = new Set(options.observers);
    this.fullEvidence = options.fullEvidence ?? false;
  }

  /** Public hosting-compatible handler; it neither opens stores nor starts background work. */
  readonly handle: ProtocolHandler = async (req) => {
    const path = new URL(req.url).pathname;
    if (path === "/health" && req.method === "GET") return Response.json({ status: "ok" });
    if (path === "/query") return text("Registrar does not serve wallet queries", 403);
    if (path !== "/" && path !== "/ingest") return text("Not Found", 404);
    if (req.method !== "POST") return text("Signed POST query required", 403);
    const publication = path === "/ingest";
    if (!isCesrContentType(req.headers.get("content-type"))) {
      await req.body?.cancel();
      return text("Unacceptable content type", publication ? 415 : 406);
    }
    const authenticated = await this.authenticate(
      req,
      publication ? this.publishers : this.observers,
      publication ? ["tels/publish"] : ["tels/bulk", "regs"],
    );
    if (authenticated instanceof Response) return authenticated;
    const q = authenticated;
    if (publication) {
      if (typeof q.stream !== "string" || !q.stream) return text("q.stream must contain public CESR evidence", 400);
      const result = await this.ingest(b(q.stream), req.signal);
      return Response.json(result, {
        status: Object.keys(result.rejected).length ? 422 : Object.keys(result.pending).length ? 202 : 200,
      });
    }
    if (Object.hasOwn(q, "vcid")) return text("Registrar does not serve wallet queries", 403);
    const sn = ordinal(q.sn), registries = registryScope(q.i, this.store);
    if (sn === null || registries === null) return text("Invalid bulk registry scope or ordinal", 400);
    if (registries.some((regid) => !this.store.head(regid))) return text("Unknown registry", 404);
    const tel: Uint8Array[] = [], kel: Uint8Array[] = [], issuers = new Set<string>();
    for (const regid of registries) {
      const history = [...this.store.cloneTelIter(regid)];
      const events = history.map((wire) => parseBytes(wire)[0].body);
      if (
        !events.every((event): event is SerderACDC =>
          event instanceof SerderACDC && ["rip", "bup"].includes(event.ilk ?? "")
        )
      ) {
        return text("Registry history is outside the supported evidence profile", 422);
      }
      if (this.fullEvidence) {
        const issuer = this.store.seqEvent(regid, 0)!.issuer!;
        if (!issuers.has(issuer)) {
          const kever = this.processor.kvy.db.getKever(issuer);
          if (!kever) return text("Supporting controller evidence is unavailable", 503);
          kel.push(...this.processor.kvy.db.cloneDelegation(kever), ...this.processor.kvy.db.clonePreIter(issuer));
          issuers.add(issuer);
        }
      }
      for (const [i, event] of events.entries()) {
        if (BigInt(`0x${event.sad!.n}`) >= BigInt(sn)) tel.push(this.fullEvidence ? history[i] : event.raw);
      }
    }
    return new Response(new Uint8Array(concatBytes(...kel, ...tel)).buffer, {
      headers: { "Content-Type": CESR_CONTENT_TYPE },
    });
  };

  /** Authenticate exactly one complete query through the actual shared KRAM verifier. */
  private async authenticate(
    req: Request,
    allowed: ReadonlySet<string>,
    routes: readonly string[],
  ): Promise<Record<string, unknown> | Response> {
    const raw = await readCesrRequestBytes(req);
    let frames;
    try {
      frames = parseBytes(raw);
    } catch (error) {
      if (!(error instanceof ParserError)) throw error;
      return text("Expected one complete signed query", 400);
    }
    const frame = frames[0], body = frame?.body;
    if (
      frames.length !== 1 || !(body instanceof SerderKERI) || body.ilk !== "qry"
      || body.pvrsn.major !== 2 || body.pvrsn.minor !== 0
    ) return text("Expected one KERI v2 signed query", 400);
    if (!body.pre || !allowed.has(body.pre) || !routes.includes(body.route ?? "")) {
      return text("Requester or route is not authorized", 403);
    }
    const kramer = this.processor.kvy.kramer;
    if (!(kramer instanceof Kramer)) return text("Request authentication unavailable", 503);
    const result = kramer.intake(envelopeFromFrame(frame));
    if (result.kind !== "ready") return text("KRAM refused query", 401);
    // Disabled/exempt KRAM returns ready without a receiver receipt. Only stageKram's
    // authenticated ready result carries receiverTime; it is never an HTTP claim.
    if (!result.receiverTime) return text("Enabled non-exempt request authentication required", 503);
    const q = result.envelope.serder.sad?.q;
    return record(q) ? q : text("Query must be an object", 400);
  }

  /** Ordinary native dispatch owns acceptance, durable dependencies and public opening retention. */
  async ingest(raw: Uint8Array, signal?: AbortSignal): Promise<PublicationResult> {
    const summary: PublicationResult = { accepted: {}, pending: {}, rejected: {}, heads: {} };
    let frames;
    try {
      frames = parseBytes(raw);
    } catch (error) {
      if (!(error instanceof ParserError)) throw error;
      summary.rejected.stream = "Invalid public evidence framing";
      return summary;
    }
    if (
      !frames.length || frames.some(({ body }) =>
        body instanceof SerderACDC
          ? !["rip", "bup"].includes(body.ilk ?? "")
          : !(body instanceof SerderKERI) || !["icp", "dip", "rot", "drt", "ixn", "rct"].includes(body.ilk ?? "")
      )
    ) {
      summary.rejected.stream = "Hosting accepts only public KEL and rip/bup evidence";
      return summary;
    }
    const processor = this.processor, refused = new Set<CesrFrame>();
    await run(function*() {
      for (const frame of frames) {
        signal?.throwIfAborted();
        const result = yield* processor.dispatch(frame);
        if (result.decision && "kind" in result.decision && result.decision.kind === "reject") refused.add(frame);
        if (frame.body instanceof SerderKERI && result.decision && "kind" in result.decision) {
          const decision = result.decision;
          if (decision.kind === "reject" || decision.kind === "drop") {
            summary.rejected[`kel:${frame.body.pre}`] = "KEL evidence was refused";
          } else if (decision.kind === "escrow") summary.pending[`kel:${frame.body.pre}`] = 1;
        }
      }
      yield* processor.processEscrowsOnce();
    });
    for (const frame of frames) {
      const event = frame.body;
      if (event instanceof SerderKERI) {
        if (
          event.pre && event.sn !== null
          && this.processor.kvy.db.kels.getLast(event.pre, Number(event.sn)) === event.said
        ) {
          delete summary.pending[`kel:${event.pre}`];
        }
        continue;
      }
      if (!(event instanceof SerderACDC)) continue;
      const regid = event.ilk === "rip" ? event.said! : event.regid ?? event.said!;
      const sn = ordinal(event.sad!.n);
      let bucket: "accepted" | "pending" | "rejected" = "rejected";
      if (!refused.has(frame) && sn !== null && this.store.seqSaider(regid, sn)?.qb64 === event.said) {
        bucket = "accepted";
      } else if (
        !refused.has(frame) && sn !== null
        && [this.store.baser.maes, this.store.baser.ooes].some((table) =>
          table.get(regid, sn).some(([said]) => said === event.said)
        )
      ) bucket = "pending";
      const values = summary[bucket];
      values[regid] = Number(values[regid] ?? 0) + 1;
      if (bucket === "accepted" && sn !== null) {
        const previous = summary.heads[regid];
        if (!previous || ordinal(this.store.event(previous)!.sad!.n)! < sn) summary.heads[regid] = event.said!;
      }
    }
    return summary;
  }
}
