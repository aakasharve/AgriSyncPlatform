// @vitest-environment node
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OPS-1; fix round 1: M3, M4, M2) - founder D-50 choice 2, CTO call D-101.
 *
 * The founder's own sentence: "ShramSafal keeps the original sound of every record as proof; this switch only decides whether it
 * can be played." Every screen and document says that, and NOTHING says the switch decides whether recordings are SAVED. The one
 * extra true line: "A voice Shram Sathi understood while this is off cannot be played later." (the founder's own words, lane WORD-1 / D-109:
 * "don't use recording but understanding"; it first read "A recording made while this is off..."). Nothing stored changes.
 * This is a MATERIAL notice change, so the one-time sheet asks once (and shows this change: NoticeChangeSheet.test).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tConsent } from '../../../i18n/consentTranslations';
import { tVoiceDiary } from '../../../i18n/voiceDiaryTranslations';
import { OFF_CONSEQUENCE_EN, OFF_CONSEQUENCE_MR, PROOF_KEPT_EN, PROOF_KEPT_MR, SWITCH_MEANING_EN, SWITCH_MEANING_MR, SWITCH_TITLE_EN, SWITCH_TITLE_MR } from '../../../i18n/voiceSwitchWords';
import {
    ACCEPTED_NOTICE_VERSIONS_STILL_CURRENT,
    CONSENT_NOTICE,
    NOTICE_VERSION,
} from '../gate/consentNotice';
import { isStillCurrentNoticeVersion } from '../separation/coreConsentGate';

/** The words that said the switch decides whether recordings are SAVED, or named the old title. None may survive anywhere. */
const OLD_OR_CONTRADICTING = [
    /मूळ आवाज जतन करा/,
    /Keep original voice/i,
    /Keep my original voice/i,
    /will not be saved/i,
    /to allow saving/i,
    /Allow saving of voice recordings/i,
    /Saving of (new )?voice recordings/i,
    /Stop saving new voice recordings/i,
    /नवीन आवाजी नोंदी (तुमच्या खात्यात )?जतन/,
    /जतन केल्या जाणार नाहीत/,
    /जतन करण्याची सोय/,
    // N11: ONE Marathi rendering of the founder's sentence everywhere outside Sathi's surface ("आवाज" since lane WORD-1; never the "नोंद" rendering).
    /प्रत्येक नोंदीचा मूळ आवाज/,
    /बंद असताना केलेली नोंद नंतर/,
    /यापुढची नोंद नंतर/,
];

const PUBLIC = resolve(__dirname, '../../../../public');
const doc = (path: string) => readFileSync(resolve(PUBLIC, path), 'utf8');

const mr = (key: string, bundle: 'consent' | 'diary') => (bundle === 'consent' ? tConsent('mr-IN', key) : tVoiceDiary('mr-IN', key));
const en = (key: string, bundle: 'consent' | 'diary') => (bundle === 'consent' ? tConsent('en-IN', key) : tVoiceDiary('en-IN', key));

const CONSENT_KEYS = ['toggles.fullHistoryJournal.title', 'toggles.fullHistoryJournal.meaning', 'toggles.fullHistoryJournal.body', 'revoke.whatStops'];
const DIARY_KEYS = [
    'retentionBanner.grantedTitle', 'retentionBanner.grantedBody', 'retentionBanner.deniedTitle', 'retentionBanner.deniedBody',
    'emptyState.body', 'consentToggle.title', 'consentToggle.meaning', 'consentToggle.helper',
    'firstGrant.headline', 'firstGrant.body', 'stopFutureConfirm.headline', 'stopFutureConfirm.body', 'stopFutureConfirm.keptNote',
    'stopFutureConfirm.primaryCta',
];

describe('D-50 - the founder\'s own sentence is what every screen says, and nothing contradicts it', () => {
    it('the privacy page: the new name and meaning, the founder\'s sentence, the off line, in both languages', () => {
        expect(mr('toggles.fullHistoryJournal.title', 'consent')).toBe(SWITCH_TITLE_MR);
        expect(en('toggles.fullHistoryJournal.title', 'consent')).toBe(SWITCH_TITLE_EN);
        expect(mr('toggles.fullHistoryJournal.meaning', 'consent')).toBe(SWITCH_MEANING_MR);
        expect(en('toggles.fullHistoryJournal.meaning', 'consent')).toBe(SWITCH_MEANING_EN);
        expect(mr('toggles.fullHistoryJournal.body', 'consent')).toContain(PROOF_KEPT_MR);
        expect(mr('toggles.fullHistoryJournal.body', 'consent')).toContain(OFF_CONSEQUENCE_MR);
        expect(en('toggles.fullHistoryJournal.body', 'consent')).toContain(PROOF_KEPT_EN);
        expect(en('toggles.fullHistoryJournal.body', 'consent')).toContain(OFF_CONSEQUENCE_EN);
    });

    it('the voice diary: the same name, meaning, sentence and off line in both languages', () => {
        expect(mr('consentToggle.title', 'diary')).toBe(SWITCH_TITLE_MR);
        expect(en('consentToggle.title', 'diary')).toBe(SWITCH_TITLE_EN);
        expect(mr('consentToggle.meaning', 'diary')).toBe(SWITCH_MEANING_MR);
        expect(en('consentToggle.meaning', 'diary')).toBe(SWITCH_MEANING_EN);
        expect(mr('consentToggle.helper', 'diary')).toContain(PROOF_KEPT_MR);
        expect(mr('consentToggle.helper', 'diary')).toContain(OFF_CONSEQUENCE_MR);
        expect(en('consentToggle.helper', 'diary')).toContain(PROOF_KEPT_EN);
        expect(en('consentToggle.helper', 'diary')).toContain(OFF_CONSEQUENCE_EN);
    });

    it('no screen text says the switch decides whether recordings are saved, or uses the old title (M3)', () => {
        for (const key of CONSENT_KEYS) {
            for (const text of [mr(key, 'consent'), en(key, 'consent')]) for (const bad of OLD_OR_CONTRADICTING) expect(text, key).not.toMatch(bad);
        }
        for (const key of DIARY_KEYS) {
            for (const text of [mr(key, 'diary'), en(key, 'diary')]) for (const bad of OLD_OR_CONTRADICTING) expect(text, key).not.toMatch(bad);
        }
    });

    it('English mode is English only (no Devanagari)', () => {
        for (const key of CONSENT_KEYS) expect(en(key, 'consent')).not.toMatch(/[ऀ-ॿ]/);
        for (const key of DIARY_KEYS) expect(en(key, 'diary')).not.toMatch(/[ऀ-ॿ]/);
    });

    it('the notice a farmer ticks says the founder\'s sentence and the off line, in both languages', () => {
        const voice = (lang: 'mr' | 'en') => CONSENT_NOTICE[lang].cards.find((p) => p.id === 'voiceUploads')!.purpose;
        expect(voice('en')).toContain(PROOF_KEPT_EN);
        expect(voice('en')).toContain(OFF_CONSEQUENCE_EN);
        // N11: ONE Marathi rendering outside Sathi's surface - the same two sentences, worded with "आवाज" (not "रेकॉर्डिंग", not "नोंद")
        expect(voice('mr')).toContain(PROOF_KEPT_MR);
        expect(voice('mr')).toContain(OFF_CONSEQUENCE_MR);
        expect(voice('mr')).not.toContain('नोंद');
    });
});

describe('D-50 - the documents (M3, M4): meaning, evidence copy, the real in-app place', () => {
    const ALL = ['legal/privacy_en.md', 'legal/privacy_mr.md', 'legal/terms_en.md', 'legal/terms_mr.md', 'consent/agreement_en.md', 'consent/agreement_mr.md'];

    it('no document names the old title or says the switch decides whether recordings are saved', () => {
        for (const name of ALL) for (const bad of OLD_OR_CONTRADICTING) expect(doc(name), name).not.toMatch(bad);
    });

    it('the consent form says the SAME in both languages: meaning, the founder\'s sentence, the off line, the place "गोपनीयता व संमती"', () => {
        const form = (lang: 'en' | 'mr') => doc(`consent/agreement_${lang}.md`);
        expect(form('en')).toContain(`## 1. ${SWITCH_TITLE_EN}`);
        expect(form('mr')).toContain(`## १. ${SWITCH_TITLE_MR}`);
        expect(form('en')).toContain(SWITCH_MEANING_EN);
        expect(form('mr')).toContain(SWITCH_MEANING_MR);
        expect(form('en')).toContain(PROOF_KEPT_EN);
        // The legal files keep the pre-WORD-1 text (coordinator's call, 2026-11-08), so the form is asserted as it stands there.
        expect(form('mr')).toContain('श्रमसफल प्रत्येक रेकॉर्डिंगचा मूळ आवाज पुराव्यासाठी जतन करते; हे बटण फक्त तो ऐकता येईल की नाही हे ठरवते.');
        expect(form('en')).toContain('A recording made while this is off cannot be played later.');
        expect(form('mr')).toContain('हा पर्याय बंद असताना केलेलं रेकॉर्डिंग नंतर ऐकता येणार नाही.');
        for (const lang of ['en', 'mr'] as const) {
            expect(form(lang)).toContain('गोपनीयता व संमती');
            expect(form(lang)).not.toMatch(/Settings|सेटिंग्ज/);
        }
    });

    it('N10: the speaker plays from Voice notes; reviewers play from the record (they cannot open his Voice notes)', () => {
        expect(doc('consent/agreement_en.md')).toContain('authorized reviewers on this farm can play it from the record');
        expect(doc('consent/agreement_en.md')).not.toMatch(/you and authorized reviewers[^.]*from Voice notes/i);
        expect(doc('consent/agreement_mr.md')).toContain('त्या कामाच्या नोंदीतून ऐकता येतो');
    });

    it('the Privacy Notice and the Terms say it too, in both languages', () => {
        expect(doc('legal/privacy_en.md')).toContain('ShramSafal keeps the original sound of every');
        expect(doc('legal/privacy_en.md')).toContain('cannot be played later');
        expect(doc('legal/terms_en.md')).toContain('A recording made while it is off cannot be played later.');
        expect(doc('legal/privacy_mr.md')).toContain('नंतर ऐकता येणार नाही');
        expect(doc('legal/terms_mr.md')).toContain('बंद असताना केलेलं रेकॉर्डिंग नंतर ऐकता येणार नाही.');
        expect(doc('legal/privacy_en.md')).toContain(SWITCH_TITLE_EN);
        expect(doc('legal/privacy_mr.md')).toContain(SWITCH_TITLE_MR);
    });
});

describe('WORD-1 (founder D-109) - "don\'t use recording but understanding": the switch never says recording', () => {
    it('the founder\'s approved line is exactly this, in both languages', () => {
        expect(OFF_CONSEQUENCE_MR).toBe('हा पर्याय बंद असताना श्रमसाथीने समजून घेतलेला आवाज नंतर ऐकता येणार नाही.');
        expect(OFF_CONSEQUENCE_EN).toBe('A voice Shram Sathi understood while this is off cannot be played later.');
    });

    it('no switch line, voice-list line or notice line outside the Sathi screen says "रेकॉर्डिंग" / "recording"', () => {
        const texts: Array<[string, string]> = [
            ['PROOF_KEPT_MR', PROOF_KEPT_MR], ['OFF_CONSEQUENCE_MR', OFF_CONSEQUENCE_MR],
            ['PROOF_KEPT_EN', PROOF_KEPT_EN], ['OFF_CONSEQUENCE_EN', OFF_CONSEQUENCE_EN],
            ...CONSENT_KEYS.flatMap((key): Array<[string, string]> => [[`consent:${key}:mr`, mr(key, 'consent')], [`consent:${key}:en`, en(key, 'consent')]]),
            ...DIARY_KEYS.flatMap((key): Array<[string, string]> => [[`diary:${key}:mr`, mr(key, 'diary')], [`diary:${key}:en`, en(key, 'diary')]]),
            ['diary:firstGrant.bullet1:mr', mr('firstGrant.bullet1', 'diary')], ['diary:firstGrant.bullet1:en', en('firstGrant.bullet1', 'diary')],
            ['notice:voiceUploads:mr', CONSENT_NOTICE.mr.cards.find((p) => p.id === 'voiceUploads')!.purpose],
            ['notice:voiceUploads:en', CONSENT_NOTICE.en.cards.find((p) => p.id === 'voiceUploads')!.purpose],
        ];
        for (const [name, text] of texts) {
            expect(text, name).not.toMatch(/रेकॉर्डिंग/);
            // D-31's own English "Original recording unavailable." is the founder's verbatim and sits on the player card, not on these lines.
            expect(text, name).not.toMatch(/recording/i);
        }
    });

    it('a pure wording change does not move the notice version (that would ask every farmer again)', () => {
        expect(NOTICE_VERSION).toBe('notice-2026-11-06.1');
        expect(ACCEPTED_NOTICE_VERSIONS_STILL_CURRENT).toEqual(['notice-2026-11-06.1']);
    });
});

describe('D-50 - material: the notice version moved and the one-time sheet asks once', () => {
    it('the notice version moved and only it counts as accepted', () => {
        expect(NOTICE_VERSION).toBe('notice-2026-11-06.1');
        expect(ACCEPTED_NOTICE_VERSIONS_STILL_CURRENT).toEqual([NOTICE_VERSION]);
    });

    it('a farmer who accepted the previous notice (11-02.2 or 11-05.1) is asked; one who accepted this is not', () => {
        expect(isStillCurrentNoticeVersion('notice-2026-11-02.2')).toBe(false);
        expect(isStillCurrentNoticeVersion('notice-2026-11-05.1')).toBe(false);
        expect(isStillCurrentNoticeVersion(NOTICE_VERSION)).toBe(true);
    });
});
