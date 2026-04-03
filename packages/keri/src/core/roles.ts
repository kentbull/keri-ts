/** KERI role constants mirrored from KERIpy's `kering.Roles`. */
export const Roles = Object.freeze(
  {
    controller: "controller",
    witness: "witness",
    registrar: "registrar",
    gateway: "gateway",
    watcher: "watcher",
    judge: "judge",
    juror: "juror",
    peer: "peer",
    mailbox: "mailbox",
    agent: "agent",
    indexer: "indexer",
  } as const,
);

/** Role union aligned to KERIpy's `Roles`. */
export type Role = (typeof Roles)[keyof typeof Roles];

/** Return true when the value is one of the KERIpy-authoritative roles. */
export function isRole(value: string): value is Role {
  return Object.values(Roles).includes(value as Role);
}

/** KERI endpoint-role subset currently surfaced by OOBI and Gate E flows. */
export const EndpointRoles = Object.freeze(
  {
    controller: Roles.controller,
    agent: Roles.agent,
    mailbox: Roles.mailbox,
    witness: Roles.witness,
  } as const,
);

/** Endpoint role union aligned to the supported Gate E/OOBI route surface. */
export type EndpointRole = (typeof EndpointRoles)[keyof typeof EndpointRoles];

/** Known endpoint role strings accepted by Gate E CLI and OOBI commands. */
export function isEndpointRole(value: string): value is EndpointRole {
  return Object.values(EndpointRoles).includes(value as EndpointRole);
}
