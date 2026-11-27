import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

// The billing switch (VITE_BILLING_VISIBLE, default off). featureFlags.ts reads its env in a form vi.stubEnv does not reach in
// this repo (see MeterQuestionHost.test.tsx), so the switch is turned through the module.
const billing = vi.hoisted(() => ({ on: false }));
vi.mock('../../../app/featureFlags', async (orig) => ({ ...(await orig<typeof import('../../../app/featureFlags')>()), isBillingVisible: () => billing.on }));
import { buildSettingsExtraIds, PRIVACY_TITLE } from '../settingsItems';

// Repair R1-g 1c (founder, 27 Nov: "Don't show billing card yet for Pilot users"): the owner's बिलिंग row only with the
// billing switch on. OFF is the default on every phone.
describe('buildSettingsExtraIds — billing switch OFF (the default)', () => {
    it('no billing row, even for the primary owner', () => {
        expect(buildSettingsExtraIds(true)).toEqual(['language', 'voice-diary', 'consent']);
        expect(buildSettingsExtraIds(true, true)).toEqual(['language', 'voice-diary', 'consent', 'ai-drafts']);
    });
});

describe('buildSettingsExtraIds', () => {
    // The rows as they are once billing applies (switch on).
    beforeEach(() => { billing.on = true; });
    afterEach(() => { billing.on = false; });

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
