/** KERI endpoint role constants used by endpoint auth and OOBI flows. */
export const EndpointRoles = Object.freeze({
  controller: "controller",
  agent: "agent",
  mailbox: "mailbox",
  witness: "witness",
} as const);

/** Endpoint role union aligned to the supported KERI route surface. */
export type EndpointRole =
  (typeof EndpointRoles)[keyof typeof EndpointRoles];

/** Known role strings accepted by Gate E CLI and protocol handling. */
export function isEndpointRole(value: string): value is EndpointRole {
  return Object.values(EndpointRoles).includes(value as EndpointRole);
}
