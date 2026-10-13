/**
 * Return the supplied clock time (current time by default) as KERI-friendly UTC text.
 *
 * KERI substance:
 * - durable KEL/reply records use microsecond-style RFC3339 text
 * - JavaScript only exposes millisecond precision, so `keri-ts` follows the
 *   existing convention of zero-padding the millisecond value to six digits
 */
export function makeNowIso8601(now = new Date()): string {
  const y = now.getUTCFullYear().toString().padStart(4, "0");
  const m = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = now.getUTCDate().toString().padStart(2, "0");
  const hh = now.getUTCHours().toString().padStart(2, "0");
  const mm = now.getUTCMinutes().toString().padStart(2, "0");
  const ss = now.getUTCSeconds().toString().padStart(2, "0");
  const micros = (now.getUTCMilliseconds() * 1000).toString().padStart(6, "0");
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}.${micros}+00:00`;
}

/**
 * Encode one ISO-8601 datetime string into the qualified CESR `Dater` text
 * form used in KERI DB records and reply ordering material.
 *
 * Maintainer note:
 * - `cesr-ts` currently exposes `Dater` hydration and ISO projection, but not
 *   a convenience constructor from datetime text
 * - this helper centralizes the temporary bootstrap encoding seam in `keri-ts`
 */
export function encodeDateTimeToDater(dts: string): string {
  return `1AAG${dts.replace(/:/g, "c").replace(/\./g, "d").replace(/\+/g, "p")}`;
}

/** Parse timezone-qualified RFC3339 text as epoch microseconds; invalid input returns null. */
export function timestampMicros(value: unknown): bigint | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [, base, fraction = "", zone] = match;
  const local = Date.parse(`${base}Z`);
  if (!Number.isFinite(local) || new Date(local).toISOString().slice(0, 19) !== base) return null;
  if (zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) return null;
  const epoch = Date.parse(`${base}${zone}`);
  return Number.isFinite(epoch) ? BigInt(epoch) * 1000n + BigInt(fraction.padEnd(6, "0")) : null;
}
