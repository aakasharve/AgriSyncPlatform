// @vitest-environment node
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OPS-1; fix round 1: M3, M4, M2) - founder D-50 choice 2, CTO call D-101.
 *
 * The founder's own sentence: "ShramSafal keeps the original sound of every record as proof; this switch only decides whether it
 * can be played." Every screen and document says that, and NOTHING says the switch decides whether recordings are SAVED. The one
 * extra true line (PROPOSED): "A recording made while this is off cannot be played later." Nothing stored changes.
 * This is a MATERIAL notice change, so the one-time sheet asks once (and shows this change: NoticeChangeSheet.test).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tConsent } from '../../../i18n/consentTranslations';
import { tVoiceDiary } from '../../../i18n/voiceDiaryTranslations';
import {
    OFF_CONSEQUENCE_EN,
    OFF_CONSEQUENCE_MR,
    OFF_CONSEQUENCE_NOTICE_MR,
    PROOF_KEPT_EN,
    PROOF_KEPT_MR,
    PROOF_KEPT_NOTICE_MR,
    SWITCH_MEANING_EN,
    SWITCH_MEANING_MR,
    SWITCH_TITLE_EN,
    SWITCH_TITLE_MR,
} from '../../../i18n/voiceSwitchWords';
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
        // founder decision 13: the Marathi notice copy has no "नोंद" - the same two sentences, worded with "रेकॉर्डिंग"
        expect(voice('mr')).toContain(PROOF_KEPT_NOTICE_MR);
        expect(voice('mr')).toContain(OFF_CONSEQUENCE_NOTICE_MR);
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
        expect(form('mr')).toContain(PROOF_KEPT_MR);
        expect(form('en')).toContain(OFF_CONSEQUENCE_EN);
        expect(form('mr')).toContain(OFF_CONSEQUENCE_MR);
        for (const lang of ['en', 'mr'] as const) {
            expect(form(lang)).toContain('गोपनीयता व संमती');
            expect(form(lang)).not.toMatch(/Settings|सेटिंग्ज/);
        }
    });

    it('the Privacy Notice and the Terms say it too, in both languages', () => {
        expect(doc('legal/privacy_en.md')).toContain('ShramSafal keeps the original sound of every');
        expect(doc('legal/privacy_en.md')).toContain('cannot be played later');
        expect(doc('legal/terms_en.md')).toContain('A recording made while it is off cannot be played later.');
        expect(doc('legal/privacy_mr.md')).toContain('नंतर ऐकता येणार नाही');
        expect(doc('legal/terms_mr.md')).toContain('बंद असताना केलेली नोंद नंतर ऐकता येणार नाही.');
        expect(doc('legal/privacy_en.md')).toContain(SWITCH_TITLE_EN);
        expect(doc('legal/privacy_mr.md')).toContain(SWITCH_TITLE_MR);
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
