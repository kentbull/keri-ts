/**
 * `Deno.test` collector for the real-browser lane.
 *
 * `store-contract.ts` registers its cases with `Deno.test(name, fn)`. The browser has no
 * `Deno`, so `collect` points `Deno.test` at a recorder while a registration function
 * runs, then restores it. The recorded cases are the same ones `deno test` would run.
 * Only the `(name, fn)` call form is supported; any other form throws, so a new form in
 * the suite fails loudly instead of silently dropping cases.
 */

export interface Case {
  name: string;
  fn: () => void | Promise<void>;
}

/** Run `register` with `Deno.test` recording into the returned list. */
export function collect(register: () => void): Case[] {
  const cases: Case[] = [];
  const record = (...args: unknown[]) => {
    const [name, fn] = args;
    if (args.length !== 2 || typeof name !== "string" || typeof fn !== "function") {
      throw new Error(`Unsupported Deno.test call form: ${args.map((arg) => typeof arg).join(", ")}`);
    }
    if (cases.some((known) => known.name === name)) throw new Error(`Duplicate case name: ${name}`);
    cases.push({ name, fn: fn as Case["fn"] });
  };
  const host = globalThis as unknown as { Deno?: { test: unknown } };
  const previous = host.Deno;
  const original = previous?.test;
  if (previous) previous.test = record;
  else host.Deno = { test: record };
  try {
    register();
  } finally {
    if (previous) previous.test = original;
    else delete host.Deno;
  }
  return cases;
}
