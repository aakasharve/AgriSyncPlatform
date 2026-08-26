/** The Hub "Settings" group row ids, in display order. `billing` is owner-only. */
export type SettingsExtraId = 'language' | 'consent' | 'export' | 'erase' | 'billing' | 'ai-drafts';

export function buildSettingsExtraIds(isOwner: boolean): SettingsExtraId[] {
    // spec: 2026-08-14-founder-decisions-launch-cohort-and-scope — 'ai-drafts'
    // surfaces offline voice-note drafts waiting for review; not owner-gated,
    // any farmer who recorded offline notes needs to reach it.
    const base: SettingsExtraId[] = ['language', 'consent', 'export', 'erase', 'ai-drafts'];
    return isOwner ? [...base, 'billing'] : base;
}
