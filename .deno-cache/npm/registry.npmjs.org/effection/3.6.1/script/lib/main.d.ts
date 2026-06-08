import type { Operation } from "./types.js";
/**
 * Halt process execution immediately and initiate shutdown. If a message is
 * provided, it will be logged to the console after shutdown:
 *
 * ```js
 * if (invalidArgs()) {
 *   yield* exit(5, "invalid arguments")
 * }
 * ```
 * @param status - the exit code to use for the process exit
 * @param message - message to print to the console before exiting.
 * @param returns an operation that exits the program
 */
export declare function exit(status: number, message?: string): Operation<void>;
/**
 * Top-level entry point to programs written in Effection. That means that your
 * program should only call `main` once, and everything the program does is
 * handled from within `main` including an orderly shutdown. Unlike `run`, `main`
 * automatically prints errors that occurred to the console.
 *
 * Use the {@link exit} operation form within to halt program execution
 * immediately and initiate shutdown.
 *
 * The behavior of `main` is slightly different depending on the environment it
 * is running in.
 *
 * ### Deno, Node
 *
 * When running within Deno or Node, any error which reaches `main` causes the
 * entire process to exit with an exit code of `1`.
 *
 * Additionally, handlers for `SIGINT` are attached to the
 * process, so that sending an exit signal to it causes the main task
 * to become halted. This means that hitting CTRL-C on an Effection program
 * using `main` will cause an orderly shutdown and run all cleanup code.
 *
 * > Warning! do not call `Deno.exit()` on Deno or `process.exit()` on Node
 * > directly, as this will not gracefully shutdown. Instead, use the
 * > {@link exit} operation.
 *
 * ### Browser
 *
 * When running in a browser, The `main` operation gets shut down on the
 * `unload` event.
 *
 * @param body - an operation to run as the body of the program
 * @returns a promise that resolves right after the program exits
 */
export declare function main(body: (args: string[]) => Operation<void>): Promise<void>;
//# sourceMappingURL=main.d.ts.map