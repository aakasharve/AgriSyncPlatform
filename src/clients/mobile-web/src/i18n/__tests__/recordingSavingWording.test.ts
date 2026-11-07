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
import { D2_DESCRIPTION_MR } from '../voiceSwitchWords';

const agreement = (lang: 'mr' | 'en') =>
    readFileSync(resolve(__dirname, `../../../public/consent/agreement_${lang}.md`), 'utf8');

// fix round 1 (lane OPS-1; founder D-50 choice 2, CTO call D-101): the R-series below used to pin wording that said the switch decides
// whether recordings are SAVED. The founder's D-50 sentence replaces it: ShramSafal keeps the original sound of every record as
// proof; the switch only decides whether it can be played. The exact new lines are pinned here (PROPOSED words).
// lane WORD-1 (founder D-109, 2026-11-08: "don't use recording but understanding"): the founder approved exactly these two lines.
const OFF_MR = 'हा पर्याय बंद असताना श्रमसाथीने समजून घेतलेला आवाज नंतर ऐकता येणार नाही.';
const OFF_EN = 'A voice Shram Sathi understood while this is off cannot be played later.';

describe('R4 - playback on banner', () => {
    it('exact Marathi, two lines', () => {
        expect(tVoiceDiary('mr-IN', 'retentionBanner.grantedTitle')).toBe('मूळ आवाज ऐकू देणे सुरू आहे.');
        expect(tVoiceDiary('mr-IN', 'retentionBanner.grantedBody')).toBe('प्रत्येक आवाजाची जतन स्थिती खाली पाहा.');
    });
    it('English says playback is on and points at the per-voice status', () => {
        expect(tVoiceDiary('en-IN', 'retentionBanner.grantedTitle')).toBe('Playback of your original voice is on.');
        expect(tVoiceDiary('en-IN', 'retentionBanner.grantedBody')).toBe("See each voice's saving status below.");
    });
});

describe('R5 - playback off banner', () => {
    it('exact Marathi, two lines, no English line', () => {
        expect(tVoiceDiary('mr-IN', 'retentionBanner.deniedTitle')).toBe('मूळ आवाज ऐकू देणे बंद आहे.');
        expect(tVoiceDiary('mr-IN', 'retentionBanner.deniedBody')).toBe(`${OFF_MR} काहीही मिटवलं जात नाही.`);
        expect(tVoiceDiary('mr-IN', 'retentionBanner.deniedBody')).not.toMatch(/[A-Za-z]/);
    });
    it('English: a voice Shram Sathi understood while off cannot be played later, nothing is erased', () => {
        expect(tVoiceDiary('en-IN', 'retentionBanner.deniedTitle')).toBe('Playback of your original voice is off.');
        expect(tVoiceDiary('en-IN', 'retentionBanner.deniedBody')).toBe(`${OFF_EN} Nothing is erased.`);
    });
});

describe('R7 - turning playback off', () => {
    it('exact Marathi on the confirmation', () => {
        expect(tVoiceDiary('mr-IN', 'stopFutureConfirm.body')).toBe('बंद केल्यावर यापुढे श्रमसाथीने समजून घेतलेला आवाज नंतर ऐकता येणार नाही. पुराव्याची प्रत जतन राहते; काहीही मिटवलं जात नाही.');
    });
    it('the revoke-all confirmation says playback stops and nothing is deleted', () => {
        expect(tConsent('mr-IN', 'revoke.whatStops')).toContain('मूळ आवाज ऐकता येणार नाही; पुराव्याची प्रत जतन राहते आणि काहीही मिटवलं जात नाही.');
        expect(tConsent('en-IN', 'revoke.whatStops')).toContain('can no longer be played back; the evidence copy is still kept as proof and nothing is deleted.');
    });
    it('English confirmation', () => {
        expect(tVoiceDiary('en-IN', 'stopFutureConfirm.body')).toBe('A voice Shram Sathi understands after this cannot be played later. The evidence copy is kept; nothing is erased.');
    });
});

describe('R8 - the consent screen and the agreement say the same about "no"', () => {
    it('Marathi: the screen carries the founder sentence and the off line; the agreement says playback stops, nothing is deleted', () => {
        expect(tConsent('mr-IN', 'toggles.fullHistoryJournal.body')).toContain(OFF_MR);
        expect(agreement('mr')).toContain(`- नकार दिल्यास: ऐकणं थांबतं, पण काहीही मिटवलं जात नाही. ${OFF_MR}`);
    });
    it('English: the same', () => {
        expect(tConsent('en-IN', 'toggles.fullHistoryJournal.body')).toContain(OFF_EN);
        expect(agreement('en')).toContain(`- If you say no: playback stops and nothing is deleted. ${OFF_EN}`);
    });
});

describe('no string claims saved history or success from consent alone', () => {
    // Surfaces that describe the CONSENT / SETTING (not an individual clip).
    // The per-clip badge `cloud` ("saved") is deliberately NOT in this list:
    // it is shown only after the server acknowledged that one recording.
    const settingKeys = [
        'retentionBanner.grantedTitle', 'retentionBanner.grantedBody',
        'retentionBanner.deniedTitle', 'retentionBanner.deniedBody',
        // plr-d10 (I17, V-2): the `*En` second lines were removed from the bundles (one language at a time).
        'emptyState.body',
        'consentToggle.helper',
        'firstGrant.headline', 'firstGrant.body',
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

describe('fix round 3 (re-worded by lane WORD-1, founder D-109) - one word for one voice on the first turn-on sheet', () => {
    it('firstGrant.body in Marathi says "आवाज" and never "रेकॉर्डिंग" or "नोंद" for the voice', () => {
        const body = tVoiceDiary('mr-IN', 'firstGrant.body');
        expect(body).toContain('प्रत्येक आवाजाची जतन स्थिती');
        expect(body).toContain('प्रत्येक आवाजाची पुराव्याची प्रत');
        expect(body).not.toMatch(/रेकॉर्डिंग/);
        expect(body.replace(/आवाज नोंदी/g, '')).not.toMatch(/नोंद/);
    });
});

describe('fix round 3 add-on (re-worded by lane WORD-1, founder D-109) - "आवाज" for the voice on the same page', () => {
    it('bullet1, grantedBody and keptNote name the voice "आवाज", not "रेकॉर्डिंग" and not "नोंद"', () => {
        expect(tVoiceDiary('mr-IN', 'firstGrant.bullet1')).toBe('प्रत्येक आवाजाची जतन स्थिती दिसते');
        expect(tVoiceDiary('mr-IN', 'retentionBanner.grantedBody')).toBe('प्रत्येक आवाजाची जतन स्थिती खाली पाहा.');
        const kept = tVoiceDiary('mr-IN', 'stopFutureConfirm.keptNote');
        expect(kept).toBe('आधी जतन झालेले आवाज जसे आहेत तसेच राहतील. ते मिटवायचे असतील तर ती वेगळी कृती आहे.');
        // the switch helper paragraph on आवाज नोंदी: "आवाज" throughout (the place name is not part of this paragraph)
        const helper = tVoiceDiary('mr-IN', 'consentToggle.helper');
        expect(helper).toContain('आधी जतन झालेला आवाज तुम्ही मिटवेपर्यंत राहील.');
        expect(helper).not.toMatch(/रेकॉर्डिंग/);
        // the founder's own D-2 sentence says "आवाज नोंदीसोबत" = with the WORK record; that one stays, everything else in the paragraph is the recording
        expect(helper.replace(D2_DESCRIPTION_MR, '')).not.toMatch(/नोंद/);
        for (const k of ['firstGrant.bullet1', 'retentionBanner.grantedBody', 'stopFutureConfirm.keptNote'] as const) {
            expect(tVoiceDiary('mr-IN', k), k).not.toMatch(/नोंदी?ची|नोंदी\b/);
        }
    });
});
