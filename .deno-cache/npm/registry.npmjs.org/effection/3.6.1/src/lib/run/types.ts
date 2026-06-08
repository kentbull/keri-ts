import type { Result } from "../types.js";

export type Exit<T> = {
  type: "aborted";
} | {
  type: "crashed";
  error: Error;
} | {
  type: "result";
  result: Result<T>;
};

/**
 * @ignore
 */
export type FrameResult<T> = Result<void> & {
  exit: Exit<T>;
  destruction: Result<void>;
};
