/** Explicit ACDC inventory and consent over borrowed authenticated protocol evidence. */
import {
  bytesEqual,
  collectPayload,
  nestedPayload,
  SerderACDC,
  type SerderKERI,
  type Versionage,
  Vrsn_2_0,
} from "cesr-ts";
import { type Operation } from "effection";
import { loadNests, type RegistryStore } from "keri-ts/db";
import {
  acceptedRegistryEvidence,
  type CredentialViews,
  type Exchanger,
  type Habery,
  type HeldCredential,
  IpexAdmitter,
  type PreparedAdmit,
  type Receiptor,
  type RegistryDisclosure,
  ValidationError,
  vet,
  type WitnessAuthMap,
} from "keri-ts/runtime";
import {} from "./disclosing.ts";
import { type AdmittedCredential, type IssuedCredential, WalletBaser } from "./storing.ts";

/** Standard padded base64; stored `raw` values and their round-trip check depend on this alphabet. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Decode stored `raw`; malformed input yields bytes that fail the caller's round-trip check. */
function fromBase64(encoded: string): Uint8Array {
  try {
    return Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  } catch {
    return new Uint8Array(0);
  }
}

/** Borrowed protocol owners and the application's separately owned inventory environment. */
export interface WalletOptions {
  hby: Habery;
  registry: RegistryStore;
  exc: Exchanger;
  db: WalletBaser;
}
/** Compare durable application values, including exact originally issued raw bytes. */
function identical(left: object, right: object): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export type { HeldCredential, PreparedAdmit };

/** Inventory owns consent, never protocol acceptance, current standing or custody. */
export class Wallet implements CredentialViews {
  readonly hby: Habery;
  readonly registry: RegistryStore;
  readonly exc: Exchanger;
  readonly db: WalletBaser;

  private readonly admitter: IpexAdmitter;

  constructor({ hby, registry, exc, db }: WalletOptions) {
    if (exc.hby !== hby) throw new ValidationError("Wallet requires its actual Exchanger.");
    this.hby = hby;
    this.registry = registry;
    this.exc = exc;
    this.db = db;
    this.admitter = new IpexAdmitter(hby, registry, exc);
  }

  /** Freeze an unsigned response only after explicit consent, exact prior authentication and current root truth. */
  prepareAdmitBody(
    grant: string,
    holder: string,
    options: { consent?: boolean; message?: string; gvrsn?: Versionage } = {},
  ): Operation<SerderKERI> {
    return this.admitter.prepareAdmitBody(grant, holder, options);
  }

  /** Sign an individual response; group approval consumes the same unsigned body through its own exact-stream owner. */
  prepareAdmit(
    grant: string,
    holder: string,
    options: {
      consent?: boolean;
      message?: string;
      gvrsn?: Versionage;
      receiptor?: Receiptor;
      auths?: WitnessAuthMap;
    } = {},
  ): Operation<PreparedAdmit> {
    return this.admitter.prepareAdmit(grant, holder, options);
  }

  /** Verify accepted local issuance, or return identical retained history without fresh proof. */
  recordIssued(acdc: SerderACDC, update: string, { blinder }: { blinder?: RegistryDisclosure } = {}): IssuedCredential {
    const event = this.registry.event(update);
    const regid = acdc.regid ?? (typeof event?.sad?.rd === "string" ? event.sad.rd : null);
    const chain = regid ? acceptedRegistryEvidence(this.registry, regid) : null;
    if (!event || !chain || !this.hby.habs.has(chain.rip.issuer!)) {
      throw new ValidationError("Local accepted issuance evidence is required.");
    }
    const index = chain.updates.findIndex((item) => item.said === update);
    if (index < 0) throw new ValidationError("Issuance update is still pending.");
    const old = this.db.issued.get([acdc.said!]);
    const raw = toBase64(acdc.raw);
    if (old && !blinder) {
      const expected: IssuedCredential = {
        credential: acdc.said!,
        registry: regid!,
        controller: chain.rip.issuer!,
        update,
        raw,
        encoding: "base64",
        bound: old.bound,
      };
      if (!identical(old, expected)) throw new ValidationError("Different issuance is already retained.");
      return old;
    }
    if (event.ilk === "bup" && !blinder) {
      throw new ValidationError("Fresh blinded issuance requires an explicit opening.");
    }
    if (blinder && event.ilk !== "bup") throw new ValidationError("Opening requires a blinded update.");
    const verified = vet({ ...chain, updates: chain.updates.slice(0, index + 1), db: this.hby.db, acdc, blinder });
    if (verified.kind !== "verified" || verified.state.state !== "issued") {
      throw new ValidationError("Referenced update does not prove issued state.");
    }
    const record: IssuedCredential = {
      credential: acdc.said!,
      registry: regid!,
      controller: chain.rip.issuer!,
      update,
      raw,
      encoding: "base64",
      bound: blinder && "bn" in blinder ? { bn: blinder.bn.num.toString(16), bd: blinder.bd.qb64 } : null,
    };
    if (old && !identical(old, record)) throw new ValidationError("Different issuance is already retained.");
    this.db.issued.put([acdc.said!], record);
    return this.db.issued.get([acdc.said!])!;
  }

  /** Reconstruct the original serialization without asserting present registry standing. */
  issuedCredential(said: string): SerderACDC {
    const record = this.db.issued.get([said]);
    if (!record || record.encoding !== "base64") throw new ValidationError("Issued credential is required.");
    const raw = fromBase64(record.raw);
    const acdc = new SerderACDC({ raw });
    if (toBase64(raw) !== record.raw || acdc.said !== said || !bytesEqual(acdc.raw, raw)) {
      throw new ValidationError("Retained issuance bytes do not match their identifier.");
    }
    return acdc;
  }

  /** Credential view for presentation: the retained issuance, as `issuedCredential` returns it. */
  issued(said: string): SerderACDC {
    return this.issuedCredential(said);
  }

  /** Credential view for presentation: the registry recorded with a retained issuance. */
  issuedRegistry(said: string): string | undefined {
    return this.db.issued.get([said])?.registry;
  }

  /** Credential view for presentation: the original admitted proof, as `heldCredential` returns it. */
  held(grant: string, options: { presenterAuthorized?: boolean } = {}): Promise<HeldCredential> {
    return this.heldCredential(grant, options);
  }

  /** Record explicit local consent to one accepted, linked Grant/Admit pair. */
  async recordAdmission(
    grant: string,
    admit: string,
    { consent = false }: { consent?: boolean } = {},
  ): Promise<AdmittedCredential> {
    if (consent !== true) throw new ValidationError("Explicit consent is required.");
    const g = await this.admitter.accepted(grant, "/ipex/grant"),
      a = await this.admitter.accepted(admit, "/ipex/admit");
    const holder = g.sad!.ri;
    if (
      typeof holder !== "string" || !this.hby.habs.has(holder) || a.pre !== holder || a.sad!.p !== grant
      || a.sad!.ri !== g.pre || this.hby.db.erpy.get([grant])?.qb64 !== admit
    ) {
      throw new ValidationError("Admit must be the intended local holder response to this Grant.");
    }
    const origin = this.admitter.origin(g);
    const old = this.db.admitted.get([grant]);
    if (old) {
      if (old.admit !== admit || old.credential !== origin || old.holder !== holder) {
        throw new ValidationError("Conflicting wallet admission.");
      }
      return old;
    }
    if (!this.exc.verifyAccepted(admit, "/ipex/admit") || !this.admitter.graphAccepted(grant, origin)) {
      throw new ValidationError("Current authenticated graph acceptance is required for new admission.");
    }
    const record: AdmittedCredential = { credential: origin, grant, admit, holder, admitted: new Date().toISOString() };
    this.db.transaction(() => {
      this.db.admitted.put([grant], record);
      this.db.credentials.put([origin, grant], grant);
    });
    return this.db.admitted.get([grant])!;
  }

  /** Read the original admitted proof; later disclosures and current policy cannot expand it. */
  async heldCredential(
    grant: string,
    { presenterAuthorized = false }: { presenterAuthorized?: boolean } = {},
  ): Promise<HeldCredential> {
    const record = this.db.admitted.get([grant]);
    if (!record && presenterAuthorized !== true) {
      throw new ValidationError(
        "Grant has not been admitted; a transferred view requires explicit presenter authorization.",
      );
    }
    const body = await this.admitter.accepted(grant, "/ipex/grant");
    const admit = record?.admit ?? this.hby.db.erpy.get([grant])?.qb64;
    if (!admit) throw new ValidationError("Transferred Grant requires its exact accepted Admit.");
    const response = await this.admitter.accepted(admit, "/ipex/admit");
    if (response.sad!.p !== grant || response.pre !== body.sad!.ri) {
      throw new ValidationError("Transferred Admit does not match the exact view.");
    }
    const nests = loadNests(this.hby.db, grant);
    const origin = nests.find((node) =>
      node.body instanceof SerderACDC && node.body.said === (record?.credential ?? this.admitter.origin(body))
    );
    if (!origin) throw new ValidationError("Admitted origin evidence is missing.");
    return {
      credential: origin.body as SerderACDC,
      proof: await collectPayload(nestedPayload(origin, Vrsn_2_0)),
      artifacts: await Promise.all(
        nests.filter((node) => node !== origin).map((node) => collectPayload(nestedPayload(node, Vrsn_2_0))),
      ),
      grant: body,
      admit,
    };
  }

  /** List historical references, with no current-standing or private-capability claim. */
  inventory(): { issued: IssuedCredential[]; held: AdmittedCredential[] } {
    return {
      issued: [...this.db.issued.getTopItemIter()].map(([, row]) => row),
      held: [...this.db.admitted.getTopItemIter()].map(([, row]) => row),
    };
  }

  /** List distinct explicit disclosure admissions for the same credential. */
  admissions(credential: string): AdmittedCredential[] {
    return [...this.db.credentials.getTopItemIter([credential])].map(([, grant]) => this.db.admitted.get([grant])!);
  }
}
