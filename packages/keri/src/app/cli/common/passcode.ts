/** Hidden terminal input owned by the command, including cancellation cleanup. */
import type { Operation } from "effection";
import process from "node:process";
import type { Key } from "node:readline";
import password from "npm:@inquirer/password@3.0.1";
import { ValidationError } from "../../../core/errors.ts";
import { abortable } from "../../abortable.ts";

/**
 * Read one hidden passcode on a real terminal and join prompt teardown.
 * Noninteractive callers must provide explicit credentials. Ctrl-D and stream
 * EOF cancel the prompt rather than leaving readline waiting for an answer.
 */
export function* readPasscode(message: string): Operation<string> {
  if (!process.stdin.isTTY) {
    throw new ValidationError("Noninteractive input requires --passcode, --aeid with --seed, or --nopasscode");
  }
  try {
    return yield* abortable(async (signal) => {
      const eof = new AbortController();
      const input = process.stdin;
      const wasRaw = input.isRaw ?? false;
      const promptSignal = AbortSignal.any([signal, eof.signal]);
      const onEnd = () => eof.abort(new ValidationError("Passcode input ended before submission"));
      const onKey = (_text: string, key: Key) => {
        if (key.ctrl && key.name === "d") onEnd();
      };
      input.once("end", onEnd);
      input.once("close", onEnd);
      input.on("keypress", onKey);
      try {
        if (input.readableEnded || input.destroyed) onEnd();
        promptSignal.throwIfAborted();
        return await password({ message, mask: false }, {
          output: process.stderr,
          signal: promptSignal,
          clearPromptOnDone: true,
        });
      } catch (error) {
        // The prompt wraps cancellation; preserve the exact owned reason for
        // abortable's joined-cleanup filtering. Foreign teardown faults survive.
        if (
          promptSignal.aborted && error instanceof Error && error.name === "AbortPromptError"
          && error.cause === promptSignal.reason
        ) {
          throw promptSignal.reason;
        }
        throw error;
      } finally {
        input.removeListener("end", onEnd);
        input.removeListener("close", onEnd);
        input.removeListener("keypress", onKey);
        if (input.isTTY && input.isRaw !== wasRaw) input.setRawMode(wasRaw);
      }
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === "ExitPromptError") {
      throw new ValidationError("Passcode input cancelled", { cause });
    }
    throw cause;
  }
}
