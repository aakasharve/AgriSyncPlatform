/**
 * MASKING IS A STATE, NOT TEXT (Preservation Register A14, B16).
 *
 * The server redacts per role. A farmer's name can arrive as the literal
 * marker `**redacted**`; a phone can arrive partly masked as `98******12`
 * (`features/farmer-health/farmer-health.types.ts:80-82,125`).
 *
 * The v3 prototype was drawn against FULL-PII sample data — it prints whole
 * phone numbers on Home, All Farms, Silent Churn, Users and in the palette
 * index — so every v3 layout assumes a real name is always there. Ported
 * literally, a redacted farm renders the six-character marker `**redacted**`
 * into a page title.
 *
 * Treating it as a state is what makes every surface render it the same way,
 * and what lets a title fall back to the farm id instead
 * (`FarmerHealthDrilldown.tsx:55` — the plan cites :52; the fallback line has
 * moved and the repo is authoritative). Today that line falls back only on an
 * EMPTY name, so a `**redacted**` name is printed verbatim.
 *
 * This is the frontend half of the founder's standing rule that
 * farmer-sensitive information is not for general internal eyes.
 */

/** The exact marker the API sends for a value the caller may not see. */
export const REDACTED = '**redacted**';

/** Fully hidden. Strict equality on purpose — a name that merely CONTAINS
 *  the word is a name, not a marker. */
export function isRedacted(v: string | null | undefined): boolean {
  return v === REDACTED;
}

/**
 * Partly hidden: `98******12`. Still usable — an operator can match the last
 * two digits against a farmer on the phone — so it is rendered as sent, not
 * swallowed. It is flagged so a surface can style it as the partial truth it
 * is, rather than as a full reading.
 */
export function isPartlyMasked(v: string | null | undefined): boolean {
  return typeof v === 'string' && !isRedacted(v) && /\*{2,}/.test(v);
}

/** What a value's visibility actually is. `Masked` puts this on the DOM as
 *  `data-masked`, so a test asserts on the contract and not on a class. */
export type MaskState = 'none' | 'partial' | 'redacted';

export function maskState(v: string | null | undefined): MaskState {
  if (isRedacted(v)) return 'redacted';
  if (isPartlyMasked(v)) return 'partial';
  return 'none';
}
