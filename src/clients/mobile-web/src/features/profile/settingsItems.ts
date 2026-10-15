/** The Hub "Settings" group row ids, in display order. `billing` is owner-only. */
export type SettingsExtraId = 'language' | 'voice-diary' | 'consent' | 'export' | 'erase' | 'billing' | 'ai-drafts';

export function buildSettingsExtraIds(isOwner: boolean): SettingsExtraId[] {
    // spec: 2026-08-14-founder-decisions-launch-cohort-and-scope — 'ai-drafts'
    // surfaces offline voice-note drafts waiting for review; not owner-gated,
    // any farmer who recorded offline notes needs to reach it.
    // 'voice-diary' reopens the Settings page (Voice Journal + retention consent
    // + diary). The header gear that led there was removed with the floating
    // header (2026-09-01), orphaning it; any farmer may use it, so not owner-gated.
    const base: SettingsExtraId[] = ['language', 'voice-diary', 'consent', 'export', 'erase', 'ai-drafts'];
    return isOwner ? [...base, 'billing'] : base;
}
