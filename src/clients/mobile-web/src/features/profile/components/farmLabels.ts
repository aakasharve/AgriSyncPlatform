/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure display-label helpers for the multi-farm Profile. Phase 1 keeps
 * tenure / member-type UI-only (no persistence); these map a value to a
 * bilingual label, defaulting gracefully so a missing value never crashes.
 */
export type Tenure = 'owned' | 'leased';
export type MemberType = 'family' | 'leased' | 'temporary';

const TENURE: Record<Tenure, { mr: string; en: string }> = {
    owned: { mr: 'मालकीची', en: 'Owned' },
    leased: { mr: 'भाडेपट्टा', en: 'Leased' },
};
const MEMBER: Record<MemberType, { mr: string; en: string }> = {
    family: { mr: 'कुटुंब', en: 'Family' },
    leased: { mr: 'भाडेपट्टा', en: 'Leased' },
    temporary: { mr: 'तात्पुरता', en: 'Temporary' },
};

export const tenureLabel = (t: Tenure) => ({ key: t, ...TENURE[t] });
export const memberTypeLabel = (m: MemberType) => ({ key: m, ...MEMBER[m] });

/**
 * Label for `farm.farmCode`.
 *
 * This USED TO render `७/१२ · GT4702` — presenting the value as the farmer's
 * 7/12 extract, the Maharashtra land record that proves who owns a holding.
 * It is nothing of the kind. `generateFarmCode()` in `qrTokenClient.ts` picks
 * six characters out of `randomBytes(6)`; it is the code a worker types to
 * join the farm, and it is not derived from any government record.
 *
 * Telling a farmer his land-record number is a string we invented is a false
 * claim about the one document he cares most about, so the label now says what
 * the value actually is — in the app's own existing wording for it, "Farm code ·
 * शेती कोड" (`FirstFarmWizard`, `FarmInviteQrSheet`).
 *
 * A real 7/12 (survey / gat number) is deliberately not collected yet — see
 * docs/DECISIONS-BEFORE-FIRST-FARMERS-2026-08-23.md Part 4. When it is, it gets
 * its own field and its own label; it does not reclaim this one.
 *
 * `P4`/`P5` — evidence: that document, Decision 2 item 3.
 */
export const farmCodeLabel = (farmCode: string | null, language: 'mr' | 'en' = 'mr'): string | null =>
    farmCode ? `${language === 'mr' ? 'शेती कोड' : 'Farm code'} · ${farmCode}` : null;
