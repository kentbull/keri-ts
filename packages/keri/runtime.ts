/**
 * Explicit non-browser-safe runtime surface for `keri-ts`.
 *
 * This subpath exists so the package root can stay browser-safe by default
 * while runtime, HTTP networking and host-adjacent concerns remain available
 * to trusted consumers such as `tufa`. TCP sockets and local-file reads live
 * in `keri-ts/runtime/node`.
 */
export * from "./src/runtime/index.ts";
