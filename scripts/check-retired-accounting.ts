/** Prevent deleted accounting APIs from returning during the removal migration.
 * Expand this list with each completed family; it is not proof of full removal.
 * Semantic review remains necessary for renamed mechanisms and new policy.
 */
const retired =
  /\b(?:CueByteReservation|CueByteAdmission|CueByteLimits|reserveCueBytes|admitCueBytes|Outboxer|DisabledOutboxer|OutboxerLike|createOutboxer|OutboxMessageRecord|OutboxTargetRecord|MailboxInbox|MailboxDelivery|MailboxAdmissionError|mailboxAdmission|KramReceipt|kramReceipt|kramReceiptTime|kready|resumingReady|FactorCredits|validateKramFactors|kpnd|KramHandoff|isKramHandoffActive|kramSnapshotIdentity|snapshotKram|storeKramSnapshot|removeKramSnapshot|withKramHydration|withKramSnapshot|AliasIdLimits|CapturedAliasIds|consumeAliasCredential|cloneCredBounded|maxRegistryEvents|PreparedSignal|checkSignalJson|maxSignals|maxSignalBytes|PreparedCueRoute|prepareCueRoute|admitCueRoute|OwnedCueTarget|CueDeck|OwnedCue|PreparedCueBatch|DeckFullError|maxPendingCues|maxQueryCues|CueReader|CueQueue)\b/;
const violations: string[] = [];

async function inspect(directory: string): Promise<void> {
  for await (const entry of Deno.readDir(directory)) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory) {
      await inspect(path);
    } else if (entry.isFile && /\.(?:ts|js)$/.test(path)) {
      const lines = (await Deno.readTextFile(path)).split("\n");
      lines.forEach((line, index) => {
        if (retired.test(line)) violations.push(`${path}:${index + 1}: retired API`);
      });
    }
  }
}

for (const name of ["cesr", "keri", "tufa"]) {
  await inspect(`packages/${name}/src`);
}
if (violations.length) {
  console.error(violations.join("\n"));
  Deno.exitCode = 1;
} else {
  console.log("Retired accounting API check passed (incremental removal boundary).");
}
