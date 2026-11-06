/** Controller-side witness TOTP registration over the witness-hk `POST /aids` contract. */
import { concatBytes, Matter } from "cesr-ts";
import { call, type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { type Hab } from "../identity/habbing.ts";
import { CESR_DESTINATION_HEADER } from "../transport/cesr-http.ts";
import type { HttpClient } from "../transport/http-client.ts";

/** One witness to register with: its AID and the base URL serving `/aids`. */
export interface WitnessRegistrationTarget {
  eid: string;
  url: string;
}

/** Plaintext TOTP secret and the witness's controller OOBI from one registration. */
export interface WitnessRegistration {
  secret: string;
  oobi: string;
}

/**
 * Register `hab` with one witness and return the plaintext TOTP secret.
 *
 * Locksmith correspondence: `register_with_witness`. The controller's full KEL
 * (and, when delegated, its delegation chain as `delkel`) and an optional batch
 * `secret` go as multipart text fields with `CESR-DESTINATION`; the returned
 * `totp` ciphertext is opened with the habitat's current keys (`Hab.decrypt`).
 * Because the full KEL is sent, registration works at any key state. Nothing
 * is persisted here: retaining or displaying the secret is the caller's choice.
 */
export function* registerWithWitness(
  hab: Hab,
  witness: WitnessRegistrationTarget,
  http: HttpClient,
  { secret }: { secret?: string } = {},
): Operation<WitnessRegistration> {
  const kever = hab.kever;
  if (!kever) throw new ValidationError(`Missing accepted key state for ${hab.pre}.`);
  const genus = kever.serder.pvrsn, text = new TextDecoder();
  const form = new FormData();
  form.set("kel", text.decode(concatBytes(...hab.db.clonePreIter(hab.pre, 0, genus))));
  if (secret !== undefined) form.set("secret", secret);
  if (kever.delegated) form.set("delkel", text.decode(concatBytes(...hab.db.cloneDelegation(kever, genus))));
  const encoded = new Response(form);
  const body = new Uint8Array(yield* call(() => encoded.arrayBuffer()));
  const response = yield* http.request(new URL("/aids", witness.url).href, {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": encoded.headers.get("Content-Type")!, [CESR_DESTINATION_HEADER]: witness.eid },
    body,
  });
  if (!response.ok) throw new ValidationError(`Witness registration failed with HTTP ${response.status}.`);
  const data = JSON.parse(text.decode(response.body));
  if (typeof data?.totp !== "string") throw new ValidationError("Witness registration response lacks totp.");
  const plain = hab.decrypt(data.totp);
  try {
    return {
      secret: text.decode(new Matter({ qb64b: plain }).raw),
      oobi: typeof data.oobi === "string" ? data.oobi : "",
    };
  } finally {
    plain.fill(0);
  }
}
