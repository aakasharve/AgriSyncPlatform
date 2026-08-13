/** The Hub "Settings" group row ids, in display order. `billing` is owner-only. */
export type SettingsExtraId = 'language' | 'consent' | 'export' | 'erase' | 'billing';

export function buildSettingsExtraIds(isOwner: boolean): SettingsExtraId[] {
    const base: SettingsExtraId[] = ['language', 'consent', 'export', 'erase'];
    return isOwner ? [...base, 'billing'] : base;
}
