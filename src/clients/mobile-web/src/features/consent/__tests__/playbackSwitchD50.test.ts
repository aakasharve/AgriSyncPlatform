// @vitest-environment node
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OPS-1) - founder D-50 (2026-11-06, choice 2).
 *
 * Every recording's evidence copy is always kept as proof. The switch that used to be called "Keep original voice"
 * ("मूळ आवाज जतन करा") is renamed "Allow playback of my original voice" ("मूळ आवाज ऐकू देणे"): it decides only whether
 * the original voice can be played back, and turning it OFF stops playback but never deletes. Nothing stored changes.
 * This is a MATERIAL notice change, so the one-time sheet asks once.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tConsent } from '../../../i18n/consentTranslations';
import { tVoiceDiary } from '../../../i18n/voiceDiaryTranslations';
import {
    ACCEPTED_NOTICE_VERSIONS_STILL_CURRENT,
    CONSENT_NOTICE,
    NOTICE_VERSION,
} from '../gate/consentNotice';
import { isStillCurrentNoticeVersion } from '../separation/coreConsentGate';

const NEW_MR = 'मूळ आवाज ऐकू देणे';
const NEW_EN = 'Allow playback of my original voice';
const OLD = [/मूळ आवाज जतन करा/, /Keep original voice/i, /Keep my original voice/i];

const LEGAL = resolve(__dirname, '../../../../public');
const doc = (path: string) => readFileSync(resolve(LEGAL, path), 'utf8');

describe('D-50 - the switch is renamed in both languages, everywhere the farmer reads it', () => {
    it('the privacy page switch shows the new words and none of the old', () => {
        for (const key of ['toggles.fullHistoryJournal.title', 'toggles.fullHistoryJournal.meaning', 'toggles.fullHistoryJournal.body']) {
            for (const locale of ['mr-IN', 'en-IN'] as const) {
                const text = tConsent(locale, key);
                for (const old of OLD) expect(text).not.toMatch(old);
            }
        }
        expect(tConsent('mr-IN', 'toggles.fullHistoryJournal.title')).toBe(NEW_MR);
        expect(tConsent('en-IN', 'toggles.fullHistoryJournal.title')).toBe(NEW_EN);
    });

    it('the voice diary switch shows the new words, its help says the evidence copy is always kept', () => {
        expect(tVoiceDiary('mr-IN', 'consentToggle.title')).toBe(NEW_MR);
        expect(tVoiceDiary('en-IN', 'consentToggle.title')).toBe(NEW_EN);
        expect(tVoiceDiary('en-IN', 'consentToggle.helper')).toMatch(/evidence copy of every recording is always kept as proof/);
        expect(tVoiceDiary('en-IN', 'consentToggle.helper')).toMatch(/nothing is deleted/);
        expect(tVoiceDiary('mr-IN', 'consentToggle.helper')).toContain('पुराव्याची प्रत नेहमी जतन केली जाते');
        for (const key of ['consentToggle.title', 'consentToggle.meaning', 'consentToggle.helper', 'emptyState.body']) {
            for (const locale of ['mr-IN', 'en-IN'] as const) {
                const text = tVoiceDiary(locale, key);
                for (const old of OLD) expect(text).not.toMatch(old);
            }
        }
    });

    it('the notice a farmer ticks says every sound is kept as proof, in both languages', () => {
        const voice = (lang: 'mr' | 'en') => CONSENT_NOTICE[lang].cards.find((p) => p.id === 'voiceUploads')!.purpose;
        expect(voice('en')).toContain('evidence copy of every recording is always kept as proof');
        expect(voice('en')).toContain('never deletes');
        expect(voice('mr')).toContain('पुराव्याची प्रत नेहमी जतन केली जाते');
    });

    it('the Privacy Notice, the Terms and the consent form (Marathi and English) say it and use the new name only', () => {
        for (const name of ['legal/privacy_en.md', 'legal/privacy_mr.md', 'legal/terms_en.md', 'legal/terms_mr.md', 'consent/agreement_en.md', 'consent/agreement_mr.md']) {
            const text = doc(name);
            for (const old of OLD) expect(text, name).not.toMatch(old);
        }
        expect(doc('legal/privacy_en.md')).toContain('evidence copy of every recording is always kept as proof');
        expect(doc('legal/terms_en.md')).toContain('evidence copy of every recording is always kept as proof');
        expect(doc('legal/privacy_mr.md')).toContain('पुराव्याची प्रत नेहमी ठेवली जाते');
        expect(doc('legal/terms_mr.md')).toContain('पुराव्याची प्रत नेहमी ठेवली जाते');
        expect(doc('legal/privacy_en.md')).toContain(NEW_EN);
        expect(doc('legal/privacy_mr.md')).toContain(NEW_MR);
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
