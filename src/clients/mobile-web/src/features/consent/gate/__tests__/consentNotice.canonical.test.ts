// spec: plr-d10-x1-consent-tick-on-phone-screen-2026-10-25 (AC9, AC13–AC15, AC18, + buildConsentAcceptance)
//
// Authored by test-writer from the spec alone.
//
// The stored hash is taken over `canonicalNoticeText(language)`. It is only worth
// something if it covers EXACTLY what can be displayed: the tick row on the phone screen
// (lead + link + tail, and the hint shown while it is unticked) and the full notice in the
// sheet. This file pins the data half of that promise; `consentTick.test.tsx` pins the
// rendered half by walking the actual DOM.
//
// It also carries the notice-content invariants that used to live in
// `ConsentGateScreen.test.tsx` (deleted by this change) — the screen went away, the
// promises in the notice did not.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    ACCEPTED_NOTICE_VERSIONS_STILL_CURRENT,
    CONSENT_NOTICE,
    DATA_FIDUCIARY,
    NOTICE_DATA_CATEGORY_CODES,
    NOTICE_PURPOSE_CODES,
    NOTICE_VERSION,
    OWED_TO_FULL_PRIVACY_NOTICE,
    PRIVACY_POLICY_VERSION,
    TERMS_VERSION,
    canonicalNoticeText,
    type NoticeCopy,
    type NoticeLanguage,
} from '../consentNotice';
import { buildConsentAcceptance, type ConsentGateAcceptance } from '../consentAcceptance';
import { recordConsentGateAcceptance } from '../consentGateApi';
import {
    CORE_DATA_CATEGORY_CODES,
    CORE_PURPOSE_CODES,
    OPTIONAL_PURPOSE_CODES,
} from '../../../../domain/consent/CoreConsentScope';

const LANGUAGES: readonly NoticeLanguage[] = ['mr', 'en'];

// ── compile-time pins ────────────────────────────────────────────────────────────────
// `NoticeCopy` drops ageDeclaration / cta / decline. If any of them comes back, this
// assignment stops type-checking (`tsc` is part of AC12), not just the runtime test.
type RemovedNoticeField = Extract<keyof NoticeCopy, 'ageDeclaration' | 'cta' | 'decline'>;
const removedFieldsAreGone: [RemovedNoticeField] extends [never] ? true : false = true;
// `tick` is { lead; link; tail }, all strings.
const tickShape: NoticeCopy['tick'] = { lead: '', link: '', tail: '' };

/** Every string leaf of a value, with its path — the generic walk the hash must cover. */
function stringLeaves(value: unknown, path = ''): Array<{ path: string; text: string }> {
    if (typeof value === 'string') return [{ path, text: value }];
    if (Array.isArray(value)) return value.flatMap((v, i) => stringLeaves(v, `${path}[${i}]`));
    if (value !== null && typeof value === 'object') {
        return Object.entries(value).flatMap(([k, v]) => stringLeaves(v, path ? `${path}.${k}` : k));
    }
    return [];
}

/** What the screen said before this change (notice-2026-10-13.2). None of it may be hashed now. */
const RETIRED_COPY: Record<NoticeLanguage, { cta: string; declineLabel: string; declineConsequence: string; ctaDisabledHint: string; acceptanceMeaning: string }> = {
    mr: {
        cta: 'मान्य आहे — पुढे चला',
        declineLabel: 'मान्य नाही',
        declineConsequence: 'या संमतीशिवाय श्रम सफल वापरता येणार नाही. तुमची कोणतीही माहिती साठवली गेलेली नाही. विचार बदलल्यास वरची खूण करून पुढे चला.',
        ctaDisabledHint: 'पुढे जाण्यासाठी वरची खूण करा.',
        acceptanceMeaning: '‘मान्य आहे — पुढे चला’ म्हणजे (१) वापराच्या अटी मान्य, आणि (२) वरच्या कामांपुरतीच माहिती वापरायला स्वतंत्र संमती. दोन्ही वेगळ्या साठवल्या जातात आणि तितक्याच सोप्या पद्धतीने मागे घेता येतात.',
    },
    en: {
        cta: 'Agree and Continue',
        declineLabel: 'I do not agree',
        declineConsequence: 'Shram Safal cannot be used without this consent. Nothing about you has been saved. If you change your mind, tick the box above and continue.',
        ctaDisabledHint: 'Tick the box above to continue.',
        acceptanceMeaning: 'Choosing ‘Agree and Continue’ means (1) you accept the Terms of Use, and (2) you separately consent to use of only the data needed for the purposes above. The two are stored separately and can be withdrawn just as easily.',
    },
};

describe('NOTICE_VERSION — the words moved, so the version moved', () => {
    it('is a new version, never the one the old full-screen gate recorded', () => {
        expect(NOTICE_VERSION).not.toBe('notice-2026-10-13.2');
        // D-36 replaced the voice promise: a material change, so the version moved again.
        expect(NOTICE_VERSION).toBe('notice-2026-11-02.2');
        expect(NOTICE_VERSION).not.toBe('notice-2026-10-25.1');
    });

    it('D-13 — only the material version counts as accepted: the older tick is asked once more', () => {
        // lane F99 fix pass 2 (D-71, orchestrator call): the 30-day erasure wait is a MATERIAL change, so the new version
        // stands alone and everyone who accepted notice-2026-10-30.1 (or older) is asked once.
        expect(ACCEPTED_NOTICE_VERSIONS_STILL_CURRENT).toEqual([NOTICE_VERSION]);
        expect(ACCEPTED_NOTICE_VERSIONS_STILL_CURRENT).not.toContain('notice-2026-10-30.1');
        expect(ACCEPTED_NOTICE_VERSIONS_STILL_CURRENT).not.toContain('notice-2026-10-25.1');
    });

    it('AC18 — the Terms and Privacy versions move too (the documents were reworded for the tick)', () => {
        expect(TERMS_VERSION).toBe('terms-2026-11-02.2');
        // D-36: the Privacy Notice's §3 and §7 described the old absolute promise.
        expect(PRIVACY_POLICY_VERSION).toBe('privacy-2026-11-02.2');
        expect(TERMS_VERSION).not.toBe('terms-2026-08-17.1');
        expect(PRIVACY_POLICY_VERSION).not.toBe('privacy-2026-10-13.2');
    });

    it('carries all three versions inside the hashed text', () => {
        for (const language of LANGUAGES) {
            const canonical = canonicalNoticeText(language);
            expect(canonical).toContain(NOTICE_VERSION);
            expect(canonical).toContain(TERMS_VERSION);
            expect(canonical).toContain(PRIVACY_POLICY_VERSION);
            expect(canonical).not.toContain('notice-2026-10-13.2');
        }
    });
});

describe('AC18 — the served Terms and Privacy describe the tick, not the removed screen', () => {
    const LEGAL_DIR = resolve(__dirname, '../../../../../public/legal');
    /** Whitespace and inline markup flattened, so a line wrap or `**` cannot hide a phrase. */
    const readDoc = (name: string): string =>
        readFileSync(resolve(LEGAL_DIR, name), 'utf8')
            .replace(/\*\*|`/g, '')
            .replace(/\s+/g, ' ');

    const DOCS = {
        'terms_mr.md': { text: readDoc('terms_mr.md'), version: TERMS_VERSION },
        'terms_en.md': { text: readDoc('terms_en.md'), version: TERMS_VERSION },
        'privacy_mr.md': { text: readDoc('privacy_mr.md'), version: PRIVACY_POLICY_VERSION },
        'privacy_en.md': { text: readDoc('privacy_en.md'), version: PRIVACY_POLICY_VERSION },
    } as const;
    const NAMES = Object.keys(DOCS) as Array<keyof typeof DOCS>;

    it.each(NAMES)('%s no longer mentions "Agree and Continue" / "मान्य आहे — पुढे चला"', (name) => {
        const { text } = DOCS[name];
        expect(text).not.toMatch(/agree and continue/i);
        expect(text).not.toMatch(/मान्य आहे\s*[—–-]\s*पुढे चला/);
    });

    it.each(NAMES)('%s no longer describes a first-open screen ("first-open" / "पहिल्या पडद्यावर")', (name) => {
        const { text } = DOCS[name];
        expect(text).not.toMatch(/first-open/i);
        expect(text).not.toContain('पहिल्या पडद्यावर');
    });

    it.each(NAMES)('%s declares the new version it is recorded under', (name) => {
        const { text, version } = DOCS[name];
        expect(text).toContain(version);
    });

    it('the English Terms describe accepting by ticking the box', () => {
        expect(DOCS['terms_en.md'].text).toContain('ticking the box');
    });

    it('the Marathi Terms describe accepting by the tick (खूण)', () => {
        expect(DOCS['terms_mr.md'].text).toContain('खूण');
    });
});

describe('NoticeCopy — the tick replaces the age box, the CTA and the decline', () => {
    it('drops ageDeclaration, cta and decline in both languages', () => {
        expect(removedFieldsAreGone).toBe(true);
        for (const language of LANGUAGES) {
            const keys = Object.keys(CONSENT_NOTICE[language]);
            expect(keys).not.toContain('ageDeclaration');
            expect(keys).not.toContain('cta');
            expect(keys).not.toContain('decline');
        }
    });

    it('has a tick label in both languages with a non-empty tappable link', () => {
        expect(Object.keys(tickShape).sort()).toEqual(['lead', 'link', 'tail']);
        for (const language of LANGUAGES) {
            const { tick } = CONSENT_NOTICE[language];
            expect(typeof tick.lead).toBe('string');
            expect(typeof tick.link).toBe('string');
            expect(typeof tick.tail).toBe('string');
            expect(tick.link.trim().length).toBeGreaterThan(0);
            // A label that is only a link says nothing about what ticking means.
            expect(`${tick.lead}${tick.tail}`.trim().length).toBeGreaterThan(0);
        }
    });

    it('the Marathi tick names the notice and says it is accepted', () => {
        const { tick } = CONSENT_NOTICE.mr;
        expect(tick.link).toContain('माहिती वापराची सूचना');
        expect(`${tick.lead}${tick.link}${tick.tail}`).toContain('मान्य');
    });

    it('D-13 — the Marathi tick is the founder’s sentence, word for word, with the link beside it', () => {
        const { tick } = CONSENT_NOTICE.mr;
        expect(`${tick.lead}${tick.tail}`.trim()).toBe(
            'माहितीचा वापर कसा होतो हे मला समजले असून, मला सूचना व अटी मान्य आहेत. माझे वय १८ वर्षे किंवा त्याहून अधिक आहे.',
        );
        expect(tick.link).toBe('माहिती वापराची सूचना व अटी');
    });

    it('AC14 — the 18+ sentence is in the words he ticks (what makes ageDeclaredAdult: true honest)', () => {
        const mr = CONSENT_NOTICE.mr.tick;
        expect(`${mr.lead}${mr.tail}`).toContain('माझे वय १८ वर्षे किंवा त्याहून अधिक आहे');
        // ...and never hidden inside the tappable link.
        expect(mr.link).not.toContain('१८');
        const en = CONSENT_NOTICE.en.tick;
        expect(`${en.lead}${en.tail}`).toMatch(/\b18\b/);
        expect(en.link).not.toMatch(/\b18\b/);
    });

    it('rewords acceptanceMeaning and ctaDisabledHint for a tick (no button they describe exists any more)', () => {
        for (const language of LANGUAGES) {
            const c = CONSENT_NOTICE[language];
            expect(c.acceptanceMeaning.trim().length).toBeGreaterThan(0);
            expect(c.ctaDisabledHint.trim().length).toBeGreaterThan(0);
            expect(c.acceptanceMeaning).not.toBe(RETIRED_COPY[language].acceptanceMeaning);
            expect(c.ctaDisabledHint).not.toBe(RETIRED_COPY[language].ctaDisabledHint);
            expect(c.acceptanceMeaning).not.toContain(RETIRED_COPY[language].cta);
        }
    });
});

describe('canonicalNoticeText — exactly what can be displayed (AC9)', () => {
    it.each(LANGUAGES)('[%s] contains every tick-row string', (language) => {
        const c = CONSENT_NOTICE[language];
        const canonical = canonicalNoticeText(language);
        for (const line of [c.tick.lead, c.tick.link, c.tick.tail, c.acceptanceMeaning, c.ctaDisabledHint]) {
            expect(canonical).toContain(line);
        }
    });

    it.each(LANGUAGES)('[%s] contains every sheet string', (language) => {
        const c = CONSENT_NOTICE[language];
        const canonical = canonicalNoticeText(language);
        for (const line of [
            c.title, c.intro, c.brandLine, c.purposeCardsHeading,
            c.willNotDo.heading, ...c.willNotDo.items,
            c.processors,
            c.rights.heading, c.rights.where, ...c.rights.items, c.rights.withdrawal, c.rights.boardComplaint,
            c.entity.heading, c.entity.contactLabel,
            c.links.terms, c.links.privacy,
        ]) {
            expect(canonical).toContain(line);
        }
        for (const card of c.cards) {
            expect(canonical).toContain(card.title);
            expect(canonical).toContain(card.data);
            expect(canonical).toContain(card.purpose);
        }
        expect(canonical).toContain(DATA_FIDUCIARY.legalName);
        expect(canonical).toContain(DATA_FIDUCIARY.contact);
    });

    it.each(LANGUAGES)('[%s] contains EVERY string field of the notice copy — a field added later cannot slip past the hash', (language) => {
        const canonical = canonicalNoticeText(language);
        const missing = stringLeaves(CONSENT_NOTICE[language])
            .filter(({ text }) => !canonical.includes(text))
            .map(({ path }) => path);
        expect(missing).toEqual([]);
    });

    it.each(LANGUAGES)('[%s] contains none of the removed fields', (language) => {
        const canonical = canonicalNoticeText(language);
        const retired = RETIRED_COPY[language];
        expect(canonical).not.toContain(retired.cta);
        expect(canonical).not.toContain(retired.declineLabel);
        expect(canonical).not.toContain(retired.declineConsequence);
        expect(canonical).not.toContain(retired.ctaDisabledHint);
        expect(canonical).not.toContain(retired.acceptanceMeaning);
    });

    it.each(LANGUAGES)('[%s] AC13 — hashes nothing that is not notice copy: every non-metadata line is a copy string, the legal name or the contact line', (language) => {
        const c = CONSENT_NOTICE[language];
        const METADATA = /^(notice-version|terms-version|privacy-version|language|card|purposes|categories):/;
        const squash = (s: string) => s.replace(/\s+/g, '');
        const copy = new Set(stringLeaves(c).map(({ text }) => text));
        const contactLine = `${c.entity.contactLabel}:${DATA_FIDUCIARY.contact}`;
        // The tick label may be serialised as one line (it is displayed as one label).
        const tickLabel = squash(`${c.tick.lead}${c.tick.link}${c.tick.tail}`);

        const stray = canonicalNoticeText(language)
            .split('\n')
            .filter((line) => !METADATA.test(line))
            .filter((line) => line.trim().length > 0)
            .filter((line) => !copy.has(line)
                && line !== DATA_FIDUCIARY.legalName
                && line !== contactLine
                && squash(line) !== tickLabel);
        expect(stray).toEqual([]);
    });

    it('AC15 — does not hash facts the farmer is never shown (CIN, registered office)', () => {
        for (const language of LANGUAGES) {
            const canonical = canonicalNoticeText(language);
            expect(canonical).not.toContain(DATA_FIDUCIARY.cin);
            expect(canonical).not.toContain(DATA_FIDUCIARY.registeredOffice);
        }
        expect(OWED_TO_FULL_PRIVACY_NOTICE).toEqual(['cin', 'registeredOffice']);
    });

    it('a different displayed language is a different notice', () => {
        expect(canonicalNoticeText('mr')).not.toBe(canonicalNoticeText('en'));
        expect(canonicalNoticeText('mr')).toContain('language:mr');
        expect(canonicalNoticeText('en')).toContain('language:en');
    });

    it('is deterministic', () => {
        for (const language of LANGUAGES) {
            expect(canonicalNoticeText(language)).toBe(canonicalNoticeText(language));
        }
    });
});

describe('notice content invariants carried over from the deleted gate test', () => {
    it('shows no unfilled placeholder — what is unknown is omitted', () => {
        for (const language of LANGUAGES) {
            const notice = canonicalNoticeText(language);
            expect(notice).not.toMatch(/\[[^\]]*\]/);
            expect(notice.toLowerCase()).not.toContain('not yet');
            expect(notice).not.toContain('अद्याप');
        }
    });

    it("carries no नोंद in the Marathi copy except the founder's own D-36 sentence (founder decision 13)", () => {
        // D-36 (2026-10-27) gave this one sentence verbatim and it says "आवाजाच्या नोंदी".
        // The later, specific ruling is used as written; nothing else may use the word.
        const d36 = 'तुमच्या स्वतंत्र परवानगीशिवाय तुमच्या आवाजाच्या नोंदी श्रमसफलची भाषा व काम समजण्याची क्षमता सुधारण्यासाठी वापरल्या जाणार नाहीत.';
        const text = canonicalNoticeText('mr');
        expect(text).toContain(d36);
        expect(text.split(d36).join('')).not.toContain('नोंद');
    });

    it('still has the five purposes, the Board-complaint right and the one AI promise', () => {
        for (const language of LANGUAGES) {
            const c = CONSENT_NOTICE[language];
            expect(c.cards).toHaveLength(5);
            expect(c.rights.boardComplaint).toContain('Data Protection Board of India');
            expect(c.rights.boardComplaint).not.toMatch(/https?:\/\//);
        }
        // Founder D-36 (option 2): the absolute promise is replaced in BOTH languages at once,
        // so the two still make one promise — no voice use for improvement without his
        // separate permission.
        expect(CONSENT_NOTICE.mr.willNotDo.items[2]).toBe(
            'तुमच्या स्वतंत्र परवानगीशिवाय तुमच्या आवाजाच्या नोंदी श्रमसफलची भाषा व काम समजण्याची क्षमता सुधारण्यासाठी वापरल्या जाणार नाहीत.',
        );
        expect(CONSENT_NOTICE.en.willNotDo.items[2]).toMatch(/without your separate permission\.$/);
        for (const language of LANGUAGES) {
            expect(canonicalNoticeText(language)).not.toContain('will not use your voice to train AI models');
            expect(canonicalNoticeText(language)).not.toContain('AI मॉडेल शिकवण्यासाठी');
        }
    });

    it('grants exactly the core purposes and nothing optional', () => {
        expect(NOTICE_PURPOSE_CODES).toEqual(CORE_PURPOSE_CODES);
        expect(NOTICE_DATA_CATEGORY_CODES).toEqual(CORE_DATA_CATEGORY_CODES);
        for (const language of LANGUAGES) {
            for (const optional of OPTIONAL_PURPOSE_CODES) {
                expect(canonicalNoticeText(language)).not.toContain(optional);
            }
        }
    });
});

describe('buildConsentAcceptance(language)', () => {
    it.each(LANGUAGES)('[%s] reports the displayed language, current versions, all core codes, the exact notice and 18+', (language) => {
        const acceptance: ConsentGateAcceptance = buildConsentAcceptance(language);

        expect(acceptance.displayedLanguage).toBe(language);
        expect(acceptance.noticeVersion).toBe(NOTICE_VERSION);
        expect(acceptance.termsVersion).toBe(TERMS_VERSION);
        expect(acceptance.privacyPolicyVersion).toBe(PRIVACY_POLICY_VERSION);
        expect([...acceptance.purposeCodes]).toEqual([...CORE_PURPOSE_CODES]);
        expect([...acceptance.dataCategoryCodes]).toEqual([...CORE_DATA_CATEGORY_CODES]);
        expect(acceptance.canonicalNotice).toBe(canonicalNoticeText(language));
        expect(acceptance.ageDeclaredAdult).toBe(true);
    });

    it('grants nothing optional', () => {
        for (const language of LANGUAGES) {
            const codes: readonly string[] = buildConsentAcceptance(language).purposeCodes;
            for (const optional of OPTIONAL_PURPOSE_CODES) {
                expect(codes).not.toContain(optional);
            }
        }
    });

    it('the Marathi and English acceptances hash different notices', () => {
        expect(buildConsentAcceptance('mr').canonicalNotice).not.toBe(buildConsentAcceptance('en').canonicalNotice);
    });
});

describe('the accept request built from buildConsentAcceptance (AC2 body shape)', () => {
    afterEach(() => vi.unstubAllGlobals());

    it.each(LANGUAGES)('[%s] posts the new version, the displayed notice text, the language and 18+', async (language) => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ termsAcceptanceEventId: 't-1', consentGrantEventId: 'c-1' }),
        });
        vi.stubGlobal('fetch', fetchMock);

        await recordConsentGateAcceptance(buildConsentAcceptance(language), 'prereg-1');

        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toMatch(/\/shramsafal\/consent-gate\/accept$/);
        const body = JSON.parse(String((init as RequestInit).body));
        expect(body.noticeVersion).toBe(NOTICE_VERSION);
        expect(body.displayedNoticeText).toBe(canonicalNoticeText(language));
        expect(body.displayedLanguage).toBe(language);
        expect(body.ageDeclaredAdult).toBe(true);
        expect(body.preRegistrationSessionId).toBe('prereg-1');
    });
});
