/** The hub row and the privacy page's title bar say the same words (PLR-D9 T3). */
export const PRIVACY_TITLE = 'गोपनीयता व संमती';

/**
 * The offline-notes row and its page's title bar say the same words. The page lists voice notes AND
 * bill / sale-slip photos made without internet, so the name is not "आवाज नोंदी" (a waiting bill photo
 * was counted under a voice-notes label) and not "तपासायच्या…" (the redesign's word for the owner
 * approving other people's logs).
 */
// PROPOSED (Marathi)
export const OFFLINE_NOTES_TITLE = 'नेट नसताना केलेल्या नोंदी';

/** The Hub "अ‍ॅप" group row ids, in display order. `billing` is owner-only. */
export type SettingsExtraId = 'language' | 'voice-diary' | 'consent' | 'billing' | 'ai-drafts';

/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I17, PLR-D9 §6 line 100/106).
 * - 'consent' is the ONE "गोपनीयता व संमती" place; the copy of my data and erase moved inside it (they
 *   were two more rows, 'export' and 'erase').
 * - 'ai-drafts' (offline notes waiting for his review) is out of the farmer's view EXCEPT while a note is
 *   actually waiting. DEVIATION from PLR-D9 line 100 ("AI Drafts … gone from the farmer's view"), kept on
 *   purpose: it is the only door to those notes, and dropping it would lose them (founder rule: keep
 *   every real feature). With nothing waiting the row is not drawn. Where offline notes should be
 *   reviewed instead is a founder question (gap inventory HUB-4).
 * - 'voice-diary' opens the recordings page; any farmer may use it, so not owner-gated.
 */
export function buildSettingsExtraIds(isOwner: boolean, hasWaitingDrafts = false): SettingsExtraId[] {
    const base: SettingsExtraId[] = ['language', 'voice-diary', 'consent'];
    if (hasWaitingDrafts) base.push('ai-drafts');
    return isOwner ? [...base, 'billing'] : base;
}
