// spec: 2026-08-25-prod-cutover-waves
//
// Accuracy of the "saving voice recordings" wording (founder-directed R4, R5,
// R7, R8). Consent only ENABLES saving. It does not mean the saved history is
// complete, and it does not mean any particular recording is saved: each
// recording shows its own status. These tests pin the exact Marathi lines and
// forbid the old wording that read as a success / completeness claim.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tVoiceDiary, VOICE_DIARY_BUNDLES } from '../voiceDiaryTranslations';
import { tConsent, CONSENT_BUNDLES } from '../consentTranslations';

const agreement = (lang: 'mr' | 'en') =>
    readFileSync(resolve(__dirname, `../../../public/consent/agreement_${lang}.md`), 'utf8');

const R7_MR = 'यापुढच्या नवीन आवाजी नोंदी तुमच्या खात्यात जतन केल्या जाणार नाहीत. आधी जतन झालेल्या नोंदी राहतील.';
const R7_EN = 'New voice recordings from now on will not be saved to your account. Recordings saved earlier will stay.';
const R8_MR = 'नकार दिल्यास नवीन आवाजी नोंदी तुमच्या खात्यात जतन केल्या जाणार नाहीत.';

describe('R4 - saving enabled banner', () => {
    it('exact Marathi, two lines', () => {
        expect(tVoiceDiary('mr-IN', 'retentionBanner.grantedTitle')).toBe('आवाजी नोंदी खात्यात जतन करण्याची सोय सुरू आहे.');
        expect(tVoiceDiary('mr-IN', 'retentionBanner.grantedBody')).toBe('प्रत्येक नोंदीची जतन स्थिती खाली पाहा.');
    });
    it('English says saving is on and points at the per-recording status', () => {
        expect(tVoiceDiary('en-IN', 'retentionBanner.grantedTitle')).toBe('Saving of voice recordings to your account is on.');
        expect(tVoiceDiary('en-IN', 'retentionBanner.grantedBody')).toBe("See each recording's saving status below.");
    });
});

describe('R5 - saving disabled banner', () => {
    it('exact Marathi, two lines, no English line', () => {
        expect(tVoiceDiary('mr-IN', 'retentionBanner.deniedTitle')).toBe('नवीन आवाजी नोंदी खात्यात जतन करणे बंद आहे.');
        expect(tVoiceDiary('mr-IN', 'retentionBanner.deniedBody')).toBe('यामुळे आधी जतन झालेल्या नोंदी मिटणार नाहीत.');
        expect(tVoiceDiary('mr-IN', 'retentionBanner.deniedBody')).not.toMatch(/[A-Za-z]/);
    });
    it('English: new recordings are not saved, earlier ones are not erased', () => {
        expect(tVoiceDiary('en-IN', 'retentionBanner.deniedTitle')).toBe('New voice recordings are not being saved to your account.');
        expect(tVoiceDiary('en-IN', 'retentionBanner.deniedBody')).toBe('This does not erase recordings saved earlier.');
    });
});

describe('R7 - stop future saving', () => {
    it('exact Marathi on the stop-future confirmation', () => {
        expect(tVoiceDiary('mr-IN', 'stopFutureConfirm.body')).toBe(R7_MR);
    });
    it('the revoke-all confirmation carries the same sentence', () => {
        expect(tConsent('mr-IN', 'revoke.whatStops')).toContain(R7_MR);
        expect(tConsent('en-IN', 'revoke.whatStops').toLowerCase()).toContain(R7_EN.toLowerCase());
    });
    it('English stop-future', () => {
        expect(tVoiceDiary('en-IN', 'stopFutureConfirm.body')).toBe(R7_EN);
    });
});

describe('R8 - consent declined line', () => {
    it('exact Marathi on the consent screen and in the agreement', () => {
        expect(tConsent('mr-IN', 'toggles.fullHistoryJournal.body')).toContain(R8_MR);
        expect(agreement('mr')).toContain(`- ${R8_MR.replace('नकार दिल्यास', 'नकार दिल्यास:')}`);
    });
    it('English declined line on the consent screen and in the agreement', () => {
        expect(tConsent('en-IN', 'toggles.fullHistoryJournal.body')).toContain(
            'If no, new voice recordings will not be saved to your account.',
        );
        expect(agreement('en')).toContain('- If you say no: New voice recordings will not be saved to your account.');
    });
});

describe('no string claims saved history or success from consent alone', () => {
    // Surfaces that describe the CONSENT / SETTING (not an individual clip).
    // The per-clip badge `cloud` ("saved") is deliberately NOT in this list:
    // it is shown only after the server acknowledged that one recording.
    const settingKeys = [
        'retentionBanner.grantedTitle', 'retentionBanner.grantedBody',
        'retentionBanner.deniedTitle', 'retentionBanner.deniedBody',
        'emptyState.body', 'emptyState.bodyEn',
        'consentToggle.helper', 'consentToggle.helperEn',
        'firstGrant.headline', 'firstGrant.headlineEn', 'firstGrant.body', 'firstGrant.bodyEn',
        'firstGrant.bullet1',
        'stopFutureConfirm.headline', 'stopFutureConfirm.body', 'stopFutureConfirm.keptNote',
    ];
    // "are/is/will be saved" is a success claim; "will not be saved" and
    // "are not being saved" do not match (a word sits between).
    const successClaimEn = /\b(?:are|is|were|was|been|get|gets|will be)\s+(?:being\s+)?saved\b|full history|complete history|all (?:your )?(?:recordings|history)|kept in your account/i;
    const successClaimMr = /जतन केल्या जातात|जतन केले जाते|जतन होतात|जतन राहतील|जतन झाल्या आहेत|पूर्ण इतिहास|सर्व नोंदी|सर्व आवाज/;

    for (const locale of ['mr-IN', 'en-IN'] as const) {
        for (const key of settingKeys) {
            it(`${locale} ${key}`, () => {
                // "Full History Journal" is the name of the setting, not a claim.
                const text = tVoiceDiary(locale, key);
                const claimText = text.replace(/Full History Journal/g, 'the setting');
                expect(text).not.toBe(key); // the key exists
                expect(claimText).not.toMatch(successClaimMr);
                if (locale === 'en-IN' || key.endsWith('En')) {
                    expect(claimText).not.toMatch(successClaimEn);
                }
            });
        }
    }

    it('the consent screen and agreements make no completeness or success claim', () => {
        const texts = [
            tConsent('mr-IN', 'toggles.fullHistoryJournal.body'),
            tConsent('en-IN', 'toggles.fullHistoryJournal.body'),
            tConsent('mr-IN', 'revoke.whatStops'),
            tConsent('en-IN', 'revoke.whatStops'),
            agreement('mr'),
            agreement('en'),
        ];
        for (const t of texts) {
            expect(t).not.toMatch(successClaimMr);
            expect(t).not.toMatch(/full history|complete history|पूर्ण इतिहास/i);
            expect(t).not.toMatch(/\byour (?:voice )?(?:clips|recordings) are (?:kept|saved)\b/i);
        }
    });

    it('the enabled banner points at the per-recording status instead of claiming saved', () => {
        expect(tVoiceDiary('mr-IN', 'retentionBanner.grantedBody')).toContain('स्थिती');
        expect(tVoiceDiary('en-IN', 'retentionBanner.grantedBody')).toContain('status');
    });

    it('श्रमसाथी stays one word; no cloud wording in these bundles', () => {
        // Values only: key names such as pendingCloudSave are internal.
        const all = JSON.stringify([VOICE_DIARY_BUNDLES, CONSENT_BUNDLES], (_k, v) => v).replace(/"[A-Za-z]+":/g, '');
        expect(all).not.toMatch(/श्रम साथी/);
        expect(all).not.toMatch(/cloud|क्लाउड/i);
    });
});
