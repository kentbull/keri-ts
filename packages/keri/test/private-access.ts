import { assertEquals } from "jsr:@std/assert";
import type { Kevery } from "../src/core/eventing.ts";
import type { Revery } from "../src/core/routing.ts";
import type { Broker } from "../src/db/escrowing.ts";

export type EventingTestApi = Pick<
  Kevery,
  | "lookupAcceptedReceiptedEvent"
  | "reprocessEscrowedWitnessReceipt"
  | "reprocessEscrowedTransferableReceipt"
  | "reprocessEscrowedQuery"
  | "resolvePartialWitnessEscrowWitnesses"
>;

export function eventingTestApi(kvy: Kevery): EventingTestApi {
  return kvy;
}

export type RoutingTestApi = Pick<Revery, "reprocessEscrowedReply">;

export function routingTestApi(rvy: Revery): RoutingTestApi {
  return rvy;
}

export type BrokerTestApi = Pick<Broker, "processEscrowedStateNotice">;

export function brokerTestApi(broker: Broker): BrokerTestApi {
  return broker;
}

export function withPatchedMethod<
  Target extends object,
  Key extends keyof Target,
  Result,
>(
  target: Target,
  key: Key,
  replacement: Target[Key],
  fn: () => Result,
): Result {
  const original = target[key];
  Reflect.set(target, key, replacement);
  try {
    return fn();
  } finally {
    Reflect.set(target, key, original);
  }
}

export function expectKind<
  Value extends { kind: string },
  Kind extends Value["kind"],
>(
  value: Value,
  kind: Kind,
): Extract<Value, { kind: Kind }> {
  assertEquals(value.kind, kind);
  return value as Extract<Value, { kind: Kind }>;
}
