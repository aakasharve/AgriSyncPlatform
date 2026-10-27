import { describe, it, expect } from 'vitest';
import { buildSettingsExtraIds, PRIVACY_TITLE } from '../settingsItems';

describe('buildSettingsExtraIds', () => {
    // spec: plr-d10 (I17, PLR-D9 §6 line 106) — copy-of-my-data and erase live inside the ONE
    // "गोपनीयता व संमती" place, so they are no longer rows of their own.
    it('lists language, recordings and the one privacy place, in order', () => {
        expect(buildSettingsExtraIds(false)).toEqual(['language', 'voice-diary', 'consent']);
    });
    it('appends billing only for owners', () => {
        expect(buildSettingsExtraIds(true)).toEqual(['language', 'voice-diary', 'consent', 'billing']);
    });
    it('keeps the recordings door open for every role (not owner-gated)', () => {
        expect(buildSettingsExtraIds(false)).toContain('voice-diary');
    });
    // spec: plr-d10 (I17, PLR-D9 line 100) — out of the farmer's view, except while a note waits:
    // it is the only door to offline notes, and those must not be lost.
    it('shows the offline-notes review row only while a note is waiting', () => {
        expect(buildSettingsExtraIds(false, false)).not.toContain('ai-drafts');
        expect(buildSettingsExtraIds(false, true)).toEqual(['language', 'voice-diary', 'consent', 'ai-drafts']);
        expect(buildSettingsExtraIds(true, true)).toEqual(['language', 'voice-diary', 'consent', 'ai-drafts', 'billing']);
    });
    it('never offers separate export / erase rows any more', () => {
        for (const ids of [buildSettingsExtraIds(true, true), buildSettingsExtraIds(false)]) {
            expect(ids).not.toContain('export');
            expect(ids).not.toContain('erase');
        }
    });
    it('the privacy place is called the same on the hub row and on its title bar', () => {
        expect(PRIVACY_TITLE).toBe('गोपनीयता व संमती');
    });
});
