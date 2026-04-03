/** Location schemes mirrored from KERIpy's `kering.Schemes`. */
export const Schemes = Object.freeze(
  {
    tcp: "tcp",
    http: "http",
    https: "https",
  } as const,
);

/** URL scheme union aligned to KERIpy's `Schemes`. */
export type Scheme = (typeof Schemes)[keyof typeof Schemes];

/** Return true when the value is one of the supported KERI schemes. */
export function isScheme(value: string): value is Scheme {
  return Object.values(Schemes).includes(value as Scheme);
}
