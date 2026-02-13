import type { CesrFrame } from "../core/types.ts";

export interface CesrRouter {
  route(frame: CesrFrame): Promise<void>;
}

export interface RouterHandlers {
  onKeri?: (frame: CesrFrame) => Promise<void> | void;
  onAcdc?: (frame: CesrFrame) => Promise<void> | void;
  onUnknown?: (frame: CesrFrame) => Promise<void> | void;
}

export function createRouterStub(handlers: RouterHandlers = {}): CesrRouter {
  return {
    async route(frame: CesrFrame): Promise<void> {
      if (frame.serder.proto === "KERI" && handlers.onKeri) {
        await handlers.onKeri(frame);
        return;
      }
      if (frame.serder.proto === "ACDC" && handlers.onAcdc) {
        await handlers.onAcdc(frame);
        return;
      }
      if (handlers.onUnknown) {
        await handlers.onUnknown(frame);
      }
    },
  };
}
