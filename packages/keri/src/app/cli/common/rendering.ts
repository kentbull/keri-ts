/**
 * Small CLI rendering helpers shared by command adapters.
 *
 * These helpers deliberately stay at the CLI boundary. They centralize common
 * one-line JSON and text rendering without moving operator presentation into
 * app workflow services.
 */

/** Emit one compact JSON object or value on stdout. */
export function writeJsonLine(value: unknown): void {
  console.log(JSON.stringify(value));
}

/** Emit text lines on stdout in order. */
export function writeTextLines(lines: readonly string[]): void {
  for (const line of lines) {
    console.log(line);
  }
}
