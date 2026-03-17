import type { CesrMessage } from "../core/types.ts";

/** Minimal async router seam for protocol-aware message dispatch experiments. */
export interface CesrRouter {
  route(message: CesrMessage): Promise<void>;
}

/** Optional per-protocol callbacks consumed by the router stub. */
export interface RouterHandlers {
  onKeri?: (message: CesrMessage) => Promise<void> | void;
  onAcdc?: (message: CesrMessage) => Promise<void> | void;
  onUnknown?: (message: CesrMessage) => Promise<void> | void;
}

/** Create a tiny protocol router without committing to a larger routing framework. */
export function createRouterStub(handlers: RouterHandlers = {}): CesrRouter {
  return {
    async route(message: CesrMessage): Promise<void> {
      if (message.body.proto === "KERI" && handlers.onKeri) {
        await handlers.onKeri(message);
        return;
      }
      if (message.body.proto === "ACDC" && handlers.onAcdc) {
        await handlers.onAcdc(message);
        return;
      }
      if (handlers.onUnknown) {
        await handlers.onUnknown(message);
      }
    },
  };
}
