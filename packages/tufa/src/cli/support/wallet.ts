/** Tufa owns inventory-store configuration/lifetime; wallet owns admission decisions. */
import { createWalletBaser, Wallet } from "@keri-ts/wallet";
import { type Operation, resource } from "effection";
import { type CommandStoreArgs, parseBooleanOption, parseStringOption } from "keri-ts/cli";
import type { RegistryStore } from "keri-ts/db";
import type { Exchanger, Habery } from "keri-ts/runtime";

/** Parse store selection before opening application or protocol resources. */
export function walletStoreArgs(args: Record<string, unknown>): CommandStoreArgs {
  return {
    name: parseStringOption(args.name, "name"),
    base: parseStringOption(args.base, "base"),
    headDirPath: parseStringOption(args.headDirPath, "headDirPath"),
    passcode: parseStringOption(args.passcode, "passcode"),
    compat: parseBooleanOption(args.compat, "compat"),
  };
}

/** Borrow protocol owners for one enclosing command scope, closing inventory first. */
export function* openWallet(hby: Habery, registry: RegistryStore, exc: Exchanger): Operation<Wallet> {
  return yield* resource(function*(provide) {
    const db = yield* createWalletBaser({
      name: hby.name,
      base: hby.base,
      temp: hby.temp,
      headDirPath: hby.headDirPath,
    });
    try {
      yield* provide(new Wallet({ hby, registry, exc, db }));
    } finally {
      yield* db.close();
    }
  });
}
