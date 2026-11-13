/**
 * Read a group's completed credential disclosures back out of the runtime's stores, as CESR a fresh store can take.
 *
 * A host that serves a group member (for example a custodian holding a weight-0 co-member) answers a wiped
 * co-member's request for the group's credentials with these two reads, inside its own request handler, the way
 * KERIA serves its REST API from the existing databases. Both are plain reads over the Habery's exchange tables,
 * its KEL tables and the registry store: no network I/O, no writes, no new store or index, no signing, and no
 * dependence on the wallet package.
 *
 * KERIpy's late-joiner refill sends KELs, schemas, the registry TEL and then the credential. Here the credential
 * travels inside its Grant, so a disclosure is replayed as KELs, TELs, the Grant and its Admit; workflow wrappers
 * (`/multisig/*`) stay out, as in KERIpy.
 */
import { collectPayload, concatBytes, Counter, framePayload, SerderACDC, type SerderKERI, Vrsn_2_0 } from "cesr-ts";
import { call, type Operation } from "effection";
import { ValidationError } from "../../core/errors.ts";
import { loadNests } from "../../db/exchange/exchange-nests.ts";
import type { Exchanger } from "../exchanges/exchanging.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import type { IpexDiscloser } from "./ipex-discloser.ts";

/** Which side of a disclosure the group is on. */
export type DisclosureRole = "issuer" | "holder";

/** One accepted v2 Grant of a credential and the accepted Admit that answered it. */
export interface GroupDisclosure {
  /** SAID of the accepted `/ipex/grant`. */
  grant: string;
  /** SAID of the accepted `/ipex/admit` whose prior is the Grant. */
  admit: string;
  /** SAID of the Grant's single disclosed origin credential. */
  credential: string;
  /** Registry the origin credential names, or null for a registry-less credential. */
  registry: string | null;
  role: DisclosureRole;
}

/** The accepted Grant, its accepted Admit and the origin credential the Grant carries. */
interface CompletedDisclosure {
  grant: SerderKERI;
  admit: SerderKERI;
  origin: SerderACDC;
}

/**
 * Resolve `grant` to a completed disclosure, or null. Complete means: the Grant is an accepted v2 `/ipex/grant`
 * disclosing exactly one origin that its stored nests carry; `erpy.` names its response; that response is an
 * accepted v2 `/ipex/admit` whose prior is the Grant, sent by the Grant's recipient back to the Grant's sender.
 * "Accepted" is the Exchanger's own record (`exns.`): it is written only once the sender's signing threshold is met,
 * so a group's Admit counts when it holds enough weight overall, whatever weight the local member carries, and a
 * proposal or partially signed Admit still in escrow does not count. A spurn, or no response, is not complete.
 */
function completed(hby: Habery, exc: Exchanger, grant: string): CompletedDisclosure | null {
  const db = hby.db, body = db.exns.get([grant]);
  if (!body || body.said !== grant || body.route !== "/ipex/grant" || body.pvrsn.major !== 2 || !exc.complete(grant)) {
    return null;
  }
  const said = db.erpy.get([grant])?.qb64, admit = said ? db.exns.get([said]) : null;
  if (
    !admit || admit.said !== said || admit.route !== "/ipex/admit" || admit.pvrsn.major !== 2 || !exc.complete(said)
    || admit.sad!.p !== grant || admit.pre !== body.sad!.ri || admit.sad!.ri !== body.pre
  ) return null;
  const origins = (body.sad!.a as { o?: unknown } | undefined)?.o;
  if (!Array.isArray(origins) || origins.length !== 1 || typeof origins[0] !== "string") return null;
  const origin = loadNests(db, grant).find((node) => node.body instanceof SerderACDC && node.body.said === origins[0])
    ?.body as SerderACDC | undefined;
  return origin ? { grant: body, admit, origin } : null;
}

/**
 * The group's completed credential disclosures, in `erpy.` key order (by Grant SAID). Scans `erpy.` (one row per
 * accepted exchange that answered a prior) and reads the named Grant, Admit and Grant nests; nothing else.
 *
 * - `holder`: the group is the Grant's recipient and its Admit is accepted, whoever sent the Grant. This is what a
 *   wallet records as admitted.
 * - `issuer`: the group sent the Grant and is the origin credential's issuer, and the recipient's Admit is accepted.
 *   A Grant in which the group re-presents a credential it holds is not listed; that credential is listed as held.
 *
 * Neither role needs the local member to sign or to carry weight, so a weight-0 member lists the same rows as its
 * co-members once it has accepted the Admit. Listing does not reauthenticate stored proofs;
 * {@link exportDisclosureStream} does. Each Grant carries its whole credential graph, so the rows are independent
 * and need no order between them.
 */
export function listGroupDisclosures(hby: Habery, exc: Exchanger, group: string): GroupDisclosure[] {
  const found: GroupDisclosure[] = [];
  for (const [keys] of hby.db.erpy.getTopItemIter()) {
    const disclosure = completed(hby, exc, String(keys[0]));
    if (!disclosure) continue;
    const { grant, admit, origin } = disclosure;
    const role: DisclosureRole | null = grant.sad!.ri === group
      ? "holder"
      : grant.pre === group && origin.issuer === group
      ? "issuer"
      : null;
    if (!role) continue;
    found.push({ grant: grant.said!, admit: admit.said!, credential: origin.said!, registry: origin.regid, role });
  }
  return found;
}

/**
 * One dependency-ordered CESR stream for a completed disclosure, which a receiver with an empty store can process
 * front to back:
 *
 * 1. KELs, each after its delegation ancestry, with the stored signatures, witness receipts and first-seen replay
 *    attachments, of `hab`, the Grant's sender, the Admit's sender and every identifier the carried ACDC nodes name
 *    (issuers, issuees, source-seal prefixes);
 * 2. the accepted TEL (`rip`, `bup`, with any retained public opening) of every registry those nodes name;
 * 3. the Grant, as accepted, with its nests: the credential and every disclosed far node of its graph (a chained
 *    credential's dependencies travel inside it, before nothing that cites them);
 * 4. the Admit, as accepted.
 *
 * Not in the stream: schemas (JSON Schema documents are not CESR; the receiver must hold or fetch them), the
 * registry root and any other private registry state (a group root travels only as a `/registry/root` copy), the
 * group's habitat record and its members' KELs beyond those named above, OOBI and end-role replies, KRAM cache
 * rows, `/multisig/*` workflow wrappers and wallet inventory rows.
 *
 * Everything is re-encoded from stored, accepted evidence: `Exchanger.replay` revalidates each exchange's retained
 * proofs, and nothing is signed, so `hab` needs no usable signing key; a weight-0 member, or one whose signer the
 * host does not hold, exports the same stream. `hab` only adds its own KEL. A Grant that is not a completed
 * disclosure (see {@link listGroupDisclosures}) is refused with a `ValidationError`. A host passes the runtime's
 * own discloser, `runtime.operations.issuance.discloser`.
 *
 * The exchanges keep their original timestamps, so once their KRAM windows have passed, ordinary network intake
 * with KRAM enabled refuses them as replays; accepting them on import is the importer's concern, not this read's.
 */
export function* exportDisclosureStream(discloser: IpexDiscloser, hab: Hab, grant: string): Operation<Uint8Array> {
  const disclosure = completed(discloser.hby, discloser.exc, grant);
  if (!disclosure) throw new ValidationError(`Grant ${grant} is not an accepted Grant with an accepted Admit.`);
  const { admit } = disclosure, db = discloser.hby.db, exc = discloser.exc;
  const nests = loadNests(db, grant);
  const raw = concatBytes(
    Counter.makeGVC(Vrsn_2_0),
    ...yield* call(() => Promise.all(nests.map((nest) => collectPayload(framePayload(nest))))),
  );
  const support = discloser.proofSupportFor(raw, [hab.pre, disclosure.grant.pre!, admit.pre!]);
  const exchanges = yield* call(async () => {
    const chunks: Uint8Array[] = [];
    for (const said of [grant, admit.said!]) for await (const chunk of exc.replay(said)) chunks.push(chunk);
    return chunks;
  });
  return concatBytes(support, ...exchanges);
}
