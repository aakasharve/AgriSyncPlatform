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
export const sevenTwelveLabel = (farmCode: string | null): string | null =>
    farmCode ? `७/१२ · ${farmCode}` : null;
