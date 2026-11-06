// spec: plr-d10-redesign-real-integration-2026-10-25 (I17, V-2; PLR-D9 T1-T3) — the recordings screens speak
// plain Marathi, one language at a time, and call the place by ONE name: the setup hub row's "आवाज नोंदी".
import { describe, expect, it } from 'vitest';
import { tVoiceDiary, VOICE_DIARY_BUNDLES } from '../voiceDiaryTranslations';
import { tConsent } from '../consentTranslations';

const values = (o: unknown, path = ''): Array<[string, string]> =>
    typeof o === 'string'
        ? [[path, o]]
        : Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => values(v, path ? `${path}.${k}` : k));

describe('voice recordings wording (mr-IN)', () => {
    it('the place is called what the hub row calls it, with no second line', () => {
        expect(tVoiceDiary('mr-IN', 'page.title')).toBe('आवाज नोंदी');
        expect(tVoiceDiary('mr-IN', 'page.subtitle')).toBe('page.subtitle'); // the "Voice Diary · सर्व नोंदी" line is gone
    });

    it('no English anywhere in the Marathi bundle, and no doubled "मराठी · English" labels', () => {
        for (const [path, text] of values(VOICE_DIARY_BUNDLES['mr-IN'])) {
            expect(text, path).not.toMatch(/[A-Za-z]/);
            expect(text, path).not.toMatch(/ · | \/ /);
        }
    });

    it('no English second line is left in the bundle at all (one language at a time)', () => {
        for (const locale of ['mr-IN', 'en-IN'] as const) {
            for (const [path] of values(VOICE_DIARY_BUNDLES[locale])) {
                expect(path, `${locale} ${path}`).not.toMatch(/En$/);
            }
        }
    });

    it('the buttons that were doubled now say one thing', () => {
        expect(tVoiceDiary('mr-IN', 'emptyState.cta')).toBe('चालू करा');
        expect(tVoiceDiary('mr-IN', 'firstGrant.primaryCta')).toBe('मी सहमत आहे');
        expect(tVoiceDiary('mr-IN', 'firstGrant.secondaryCta')).toBe('नंतर');
        expect(tVoiceDiary('mr-IN', 'stopFutureConfirm.secondaryCta')).toBe('नको');
    });

    it('the keep switch uses the same words as the consent of the same name on गोपनीयता व संमती', () => {
        // plr-d10 I25: the founder's D-2 title, on both screens.
        expect(tVoiceDiary('mr-IN', 'consentToggle.title')).toBe('मूळ आवाज ऐकू देणे');
        expect(tConsent('mr-IN', 'toggles.fullHistoryJournal.title')).toBe(tVoiceDiary('mr-IN', 'consentToggle.title'));
        expect(tConsent('mr-IN', 'toggles.fullHistoryJournal.meaning')).toBe(tVoiceDiary('mr-IN', 'consentToggle.meaning'));
    });

    it('the old name "डायरी" is gone from the recordings screens, and no transliterated English is left', () => {
        for (const [path, text] of values(VOICE_DIARY_BUNDLES['mr-IN'])) {
            expect(text, path).not.toMatch(/डायरी|रिफ्रेश|क्लिप/);
        }
        // the first-grant confirmation names the place by its one name
        expect(tVoiceDiary('mr-IN', 'firstGrant.body')).toContain('"आवाज नोंदी" मध्ये दिसेल');
    });

    it('the play button and the refresh button are named in Marathi (they read "Play" / "रिफ्रेश")', () => {
        expect(tVoiceDiary('mr-IN', 'player.play')).toBe('ऐका');
        expect(tVoiceDiary('mr-IN', 'player.pause')).toBe('थांबवा');
        expect(tVoiceDiary('mr-IN', 'page.refresh')).toBe('नव्या नोंदी पाहा');
        expect(tVoiceDiary('en-IN', 'player.play')).toBe('Play');
    });

    it('the empty page no longer sends him to "Settings" or names an English setting', () => {
        const body = tVoiceDiary('mr-IN', 'emptyState.body');
        expect(body).not.toMatch(/सेटिंग|Full History/);
        expect(tVoiceDiary('en-IN', 'emptyState.body')).not.toMatch(/Settings|Full History Journal/);
    });
});
