// @file-test-lane core-fast-a

import { assertThrows } from "jsr:@std/assert";
import { concatBytes } from "../../../../cesr/mod.ts";
import { ValidationError } from "../../../src/core/errors.ts";
import { exchange } from "../../../src/core/protocol-exchanging.ts";
import { serializeMessage } from "../../../src/core/protocol-serialization.ts";

const SENDER = "EDmvqjn9t8x9zkPHCgn_QxTHlP-1v-qqJh-zdg7CrXVe";

Deno.test("protocol serialization rejects non-quadlet pathed material", () => {
  const [serder] = exchange("/test", {}, { sender: SENDER });

  assertThrows(
    () => serializeMessage(serder, { pathed: [new Uint8Array([1, 2, 3])] }),
    ValidationError,
    "nonintegral quadlets",
  );
});

Deno.test("protocol exchange rejects non-quadlet embedded attachment tails", () => {
  const [embedded] = exchange("/embedded", {}, { sender: SENDER });
  const badEmbedded = concatBytes(embedded.raw, new Uint8Array([1, 2, 3]));

  assertThrows(
    () => exchange("/outer", {}, { sender: SENDER, embeds: { evt: badEmbedded } }),
    Error,
    "not quadlet aligned",
  );
});
