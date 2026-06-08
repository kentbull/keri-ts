"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exit = exit;
exports.main = main;
const dntShim = __importStar(require("../_dnt.shims.js"));
const context_js_1 = require("./context.js");
const instructions_js_1 = require("./instructions.js");
const run_js_1 = require("./run.js");
const call_js_1 = require("./call.js");
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
function* exit(status, message) {
    let escape = yield* ExitContext.expect();
    escape({ status, message });
}
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
async function main(body) {
    let hardexit = (_status) => { };
    let result = await (0, run_js_1.run)(() => (0, instructions_js_1.action)(function* (resolve) {
        // action will return shutdown immediately upon resolve, so stash
        // this function in the exit context so it can be called anywhere.
        yield* ExitContext.set(resolve);
        // this will hold the event loop and prevent runtimes such as
        // Node and Deno from exiting prematurely.
        let interval = setInterval(() => { }, Math.pow(2, 30));
        try {
            let interrupt = {
                SIGINT: () => resolve({ status: 130, signal: "SIGINT" }),
                SIGTERM: () => resolve({ status: 143, signal: "SIGTERM" }),
            };
            yield* withHost({
                *deno() {
                    hardexit = (status) => Deno.exit(status);
                    try {
                        Deno.addSignalListener("SIGINT", interrupt.SIGINT);
                        /**
                         * Windows only supports ctrl-c (SIGINT), ctrl-break (SIGBREAK), and ctrl-close (SIGUP)
                         */
                        if (Deno.build.os !== "windows") {
                            Deno.addSignalListener("SIGTERM", interrupt.SIGTERM);
                        }
                        yield* body(Deno.args.slice());
                    }
                    finally {
                        Deno.removeSignalListener("SIGINT", interrupt.SIGINT);
                        if (Deno.build.os !== "windows") {
                            Deno.removeSignalListener("SIGTERM", interrupt.SIGTERM);
                        }
                    }
                },
                *node() {
                    // Annotate dynamic import so that webpack ignores it.
                    // See https://webpack.js.org/api/module-methods/#webpackignore
                    let { default: process } = yield* (0, call_js_1.call)(() => Promise.resolve().then(() => __importStar(require(/* webpackIgnore: true */ "node:process"))));
                    hardexit = (status) => process.exit(status);
                    try {
                        process.on("SIGINT", interrupt.SIGINT);
                        if (process.platform !== "win32") {
                            process.on("SIGTERM", interrupt.SIGTERM);
                        }
                        yield* body(process.argv.slice(2));
                    }
                    finally {
                        process.off("SIGINT", interrupt.SIGINT);
                        if (process.platform !== "win32") {
                            process.off("SIGTERM", interrupt.SIGINT);
                        }
                    }
                },
                *browser() {
                    try {
                        self.addEventListener("unload", interrupt.SIGINT);
                        yield* body([]);
                    }
                    finally {
                        self.removeEventListener("unload", interrupt.SIGINT);
                    }
                },
            });
            yield* exit(0);
        }
        catch (error) {
            resolve({ status: 1, error: error });
        }
        finally {
            clearInterval(interval);
        }
    }));
    if (result.message) {
        if (result.status === 0) {
            console.log(result.message);
        }
        else {
            console.error(result.message);
        }
    }
    if (result.error) {
        console.error(result.error);
    }
    hardexit(result.status);
}
const ExitContext = (0, context_js_1.createContext)("exit");
function* withHost(op) {
    let global = dntShim.dntGlobalThis;
    if (typeof global.Deno !== "undefined") {
        return yield* op.deno();
        // this snippet is from the detect-node npm package
        // @see https://github.com/iliakan/detect-node/blob/master/index.js
    }
    else if (Object.prototype.toString.call(typeof globalThis.process !== "undefined" ? globalThis.process : 0) === "[object process]") {
        return yield* op.node();
    }
    else {
        return yield* op.browser();
    }
}
//# sourceMappingURL=main.js.map