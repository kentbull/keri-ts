/** Explicit protocol composition for tests that select real optional handlers or receiver policy. */
import { RegistryObserver } from "../src/acdc/observing.ts";
import type { Regery } from "../src/acdc/registraring.ts";
import type { Verifier } from "../src/app/credentials/verifying.ts";
import { Exchanger } from "../src/app/exchanges/exchanging.ts";
import type { Habery } from "../src/app/identity/habbing.ts";
import { ProtocolProcessor } from "../src/app/protocol/protocol-processing.ts";
import { QueryReplies } from "../src/app/queries/query-replies.ts";
import type { AgentCue } from "../src/core/cues.ts";
import { Deck } from "../src/core/deck.ts";
import { Kevery, type MessagePolicy } from "../src/core/eventing.ts";
import { type KramConfig, Kramer } from "../src/core/kraming.ts";
import { Revery } from "../src/core/routing.ts";
import type { Tevery } from "../src/vdr/eventing.ts";

/** Build actual processors; this fixture owns no stores, network or background workers. */
export function protocolFixture(
  hby: Habery,
  {
    cues = new Deck<AgentCue>(),
    protocolCues,
    revery,
    tevery,
    verifier,
    registry,
    messagePolicy,
    kram,
    now = Date.now,
    local = false,
  }: {
    cues?: Deck<AgentCue>;
    protocolCues?: Deck<AgentCue>;
    revery?: Revery;
    tevery?: Tevery;
    verifier?: Verifier;
    registry?: Regery;
    messagePolicy?: MessagePolicy;
    kram?: KramConfig;
    now?: () => number;
    local?: boolean;
  } = {},
): ProtocolProcessor {
  const output = protocolCues ?? revery?.cues ?? new Deck<AgentCue>();
  const rvy = revery ?? new Revery(hby.db, { cues: output });
  const kramer = kram ? new Kramer(hby.db, { cues: output, config: kram, now }) : undefined;
  const kvy = new Kevery(hby.db, { cues: output, rvy, messagePolicy, kramer, local });
  const exc = new Exchanger(hby, { cues: output, now });
  return new ProtocolProcessor(
    kvy,
    rvy,
    exc,
    tevery ?? null,
    verifier ?? null,
    registry ? new RegistryObserver(hby.db, registry.store) : null,
    output,
    cues,
    new QueryReplies(cues),
  );
}
