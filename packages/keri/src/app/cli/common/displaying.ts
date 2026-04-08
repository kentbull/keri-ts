import { ValidationError } from "../../../core/errors.ts";
import { dgKey } from "../../../db/core/keys.ts";
import type { Habery } from "../../habbing.ts";

function decimalThreshold(value: bigint): string {
  return value.toString();
}

/** Print KLI-style external key-state output for one known identifier. */
export function printExternal(hby: Habery, pre: string, label = "Identifier"): void {
  const kever = hby.db.getKever(pre);
  if (!kever) {
    throw new ValidationError(`No known key state for prefix ${pre}.`);
  }

  const estSaid = kever.lastEst.d || kever.said;
  const witnessReceipts = estSaid
    ? hby.db.wigs.get(dgKey(pre, estSaid)).length
    : 0;

  console.log(`${label}: ${pre}`);
  console.log(`Seq No:\t${kever.sner.num.toString()}`);
  if (kever.delegated) {
    console.log("Delegated Identifier");
    console.log(`    Delegator:  ${kever.delpre ?? ""}`);
    console.log("");
  }
  console.log("");
  console.log("Witnesses:");
  console.log(`Count:\t\t${kever.wits.length}`);
  console.log(`Receipts:\t${witnessReceipts}`);
  console.log(`Threshold:\t${decimalThreshold(kever.toader.num)}`);
  console.log("");
  console.log("Public Keys:\t");
  for (const [idx, verfer] of kever.verfers.entries()) {
    console.log(`\t${idx + 1}. ${verfer.qb64}`);
  }
  console.log("");
}
