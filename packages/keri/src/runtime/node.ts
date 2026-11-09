/**
 * Host surface for Node and Deno: TCP sockets, local files and config files.
 *
 * `keri-ts/runtime` stays free of `node:` modules and the `Deno` global so it
 * can be bundled for a browser. Hosts with sockets import the TCP messengers,
 * the dialer-equipped HTTP client and the file reader from here.
 */
export { Configer, type ConfigerOptions, createConfiger } from "../app/identity/configing.ts";
export { fileBytes } from "../app/transport/file-bytes.ts";
export { NodeHttpClient, nodeTcpDialer } from "../app/transport/node-http-client.ts";
export {
  socketBytes,
  type SocketSourceOptions,
} from "../app/transport/socket-source.ts";
export {
  openTcpConnection,
  sendCesrTcp,
  sendCesrTcpFrame,
  sendCesrTcpSocket,
  streamCesrTcp,
  type TcpConnection,
  type TcpSendOptions,
  type TcpSocketWriteOptions,
  type TcpSourceFactory,
  writeCesrTcpSocket,
} from "../app/transport/tcp-egress.ts";
export {
  TCPMessenger,
  type TCPMessengerOptions,
} from "../app/transport/tcp-messenger.ts";
export { TCPStreamMessenger } from "../app/transport/tcp-stream-messenger.ts";
