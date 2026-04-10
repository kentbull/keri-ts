import type { Hab } from "./habbing.ts";

/**
 * Route-facing policy for one hosted protocol surface.
 *
 * This contract is intentionally smaller than any concrete listener config:
 * transport details such as hostname, bound port, and listen callbacks belong
 * to the host edge, while protocol composition only needs to know which local
 * identities and witness semantics are exposed through that edge.
 */
export interface ProtocolHostPolicy {
  /** Service habitat used to interpret request-scoped runtime cue semantics. */
  serviceHab?: Hab;
  /** Optional subset of locally hosted prefixes visible through one host. */
  hostedPrefixes?: readonly string[];
  /** Optional hosted witness habitat enabling witness-specific HTTP routes. */
  witnessHab?: Hab;
}
