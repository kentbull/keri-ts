/**
 * Return the current UTC time in the KERI-friendly extended ISO-8601 form.
 *
 * KERI substance:
 * - durable KEL/reply records use microsecond-style RFC3339 text
 * - JavaScript only exposes millisecond precision, so `keri-ts` follows the
 *   existing convention of zero-padding the millisecond value to six digits
 */
export function makeNowIso8601(): string {
  const now = new Date();
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
