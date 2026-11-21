/**
 * India time for a few words on screen. Days and clocks here are UTC + 05:30, the same days the
 * server counts in, and never the viewer's browser zone. A bad or missing input is `null`, and a
 * caller must say the time is not known rather than print a stand-in.
 */
const IST_OFFSET_MS = 330 * 60_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Milliseconds of an ISO-8601 instant, or NaN. .NET writes seven fractional digits; some engines
 * (older Safari) refuse more than three, so the fraction is cut to milliseconds for READING only.
 * The original string is what gets sent to the server, unchanged.
 */
export function parseInstantMs(iso: string | null | undefined): number {
  if (!iso) return Number.NaN;
  return Date.parse(iso.replace(/(\.\d{3})\d+/, '$1'));
}

/** "20 Nov 2026" (the India date of the instant), or null when `utcIso` is not a date. */
export function fmtIndiaDate(utcIso: string | null | undefined): string | null {
  if (!utcIso) return null;
  const ms = parseInstantMs(utcIso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + IST_OFFSET_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "15 Nov 2026, 2:32 pm India time", or null when `utcIso` is not a date. */
export function fmtIndiaDateTime(utcIso: string | null | undefined): string | null {
  if (!utcIso) return null;
  const ms = parseInstantMs(utcIso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + IST_OFFSET_MS);
  const h24 = d.getUTCHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${fmtIndiaDate(utcIso)}, ${h12}:${mm} ${h24 < 12 ? 'am' : 'pm'} India time`;
}
