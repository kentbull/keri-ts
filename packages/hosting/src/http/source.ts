/** One configured HTTPS response source; TLS supplies source identity, never issuer authority. */
import { call, type Operation, resource, scoped } from "effection";
import { collectBytes, type HttpResponse, TransportError, ValidationError } from "keri-ts/runtime";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { request } from "node:https";
import { isIP } from "node:net";
import { isAbsolute } from "node:path";
import { checkServerIdentity } from "node:tls";

/** An optional CA bundle augments operator trust; an IP URL may explicitly name a DNS certificate identity. */
export interface SourceConfig {
  url: string;
  caFile?: string;
  certName?: string;
}
/** Validated fixed source data; URL identity is retained exactly, not derived from a response. */
export class SourceTrust {
  readonly url: string;
  readonly caFile?: string;
  readonly certName?: string;
  readonly hostname: string;
  readonly ca?: Buffer;
  constructor({ url, caFile, certName }: SourceConfig) {
    if (typeof url !== "string" || !url.trim()) throw new ValidationError("Source URL is required.");
    const target = new URL(url.trim());
    if (target.protocol !== "https:" || target.username || target.password || target.search || target.hash) {
      throw new ValidationError("Source must be HTTPS without credentials, query or fragment.");
    }
    const host = target.hostname.replace(/^\[|\]$/g, "");
    if (
      certName !== undefined && (!isIP(host) || typeof certName !== "string" || !certName
        || isIP(certName) || !certName.split(".").every(label =>
          /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label)
        ))
    ) {
      throw new ValidationError("Separate certificate DNS name requires an IP source URL.");
    }
    if (caFile !== undefined && (typeof caFile !== "string" || !isAbsolute(caFile))) {
      throw new ValidationError("Source CA must be an absolute file path.");
    }
    this.url = url.trim();
    this.caFile = caFile;
    this.certName = certName;
    this.hostname = certName ?? host;
    this.ca = caFile ? readFileSync(caFile) : undefined;
  }
}

/**
 * Own one finite POST, absolute deadline, body reader and joined socket close.
 * Node's TLS verifier checks CA plus the configured URL/name; request never follows redirects.
 */
export function sourceRequest(source: SourceTrust, body: Uint8Array, timeoutMs: number): Operation<HttpResponse> {
  return scoped(function*() {
    return yield* resource<HttpResponse>(function*(provide) {
      const host = new URL(source.url).hostname.replace(/^\[|\]$/g, "");
      let closed!: () => void;
      const joined = new Promise<void>(resolve => closed = resolve);
      let succeed!: (response: HttpResponse) => void, fail!: (cause: unknown) => void;
      const pending = new Promise<HttpResponse>((resolve, reject) => {
        succeed = resolve;
        fail = cause => reject(new TransportError("HTTPS registrar source failed", { cause }));
      });
      const req = request(source.url, {
        method: "POST",
        agent: false,
        ca: source.ca,
        rejectUnauthorized: true,
        servername: isIP(host) ? source.certName : host,
        checkServerIdentity: (_hostname, certificate) => checkServerIdentity(source.hostname, certificate),
        headers: { "Content-Type": "application/cesr" },
      }, response => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) value.forEach(item => headers.append(key, item));
          else if (value !== undefined) headers.set(key, value);
        }
        void collectBytes(response).then(bytes =>
          succeed({
            status: response.statusCode ?? 0,
            ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300,
            headers,
            body: bytes,
          }), fail);
      });
      req.on("error", fail!);
      req.once("close", closed);
      req.end(Buffer.from(body));
      // Cancellation may finish the operation before the native promise rejects.
      void pending.catch(() => {});
      const timer = setTimeout(() => req.destroy(new Error("Registrar source deadline expired")), timeoutMs);
      try {
        yield* provide(yield* call(() => pending));
      } finally {
        clearTimeout(timer);
        req.destroy();
        yield* call(() => joined);
      }
    });
  });
}
