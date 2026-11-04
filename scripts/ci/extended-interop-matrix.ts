/** Expand existing KERI owners into bounded, independent hosted jobs. */
import { groups, suites } from "./keri-test-suites.ts";

/** One concrete owner, optionally restricted to one frozen reference peer. */
export interface ExtendedInteropRow {
  id: string;
  suite: string;
  profile: string;
  main: boolean;
  candidate: boolean;
  services: boolean;
}

/** Keep the profile owner's four peers isolated without changing its file inventory. */
export const referenceProfiles = ["main", "1.2", "1.3", "candidate"] as const;

/** Reuse suite membership and execution policy rather than maintaining another suite list. */
export function extendedInteropMatrix(target: string): { include: ExtendedInteropRow[] } {
  const owners = Object.hasOwn(suites, target) ? [target] : groups[target];
  if (!owners) throw new Error(`Unknown extended interop target: ${target}`);
  return {
    include: owners.flatMap((suite) => {
      if (!Object.hasOwn(suites, suite)) throw new Error(`Unknown KERI owner: ${suite}`);
      const profiles = suite === "interop-reference-profiles" ? referenceProfiles : [""];
      return profiles.map((profile) => ({
        id: profile ? `${suite}-${profile}` : suite,
        suite,
        profile,
        main: suite === "interop-essr-storage",
        candidate: ["interop-native-registry", "interop-ipex-disclosure", "interop-kram"].includes(suite),
        services: suite === "interop-native-registry",
      }));
    }),
  };
}

if (import.meta.main) {
  if (Deno.args.length !== 1) throw new Error("Usage: extended-interop-matrix.ts TARGET");
  console.log(JSON.stringify(extendedInteropMatrix(Deno.args[0])));
}
