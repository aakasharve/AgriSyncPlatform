// spec: dfes-companion-2026-07-11 (wave-4.3)
//
// THE DOCUMENTS THE CONSENT GATE PROMISES ACTUALLY EXIST, AND SAY WHAT THE CODE DOES.
//
// Before this suite, `ConsentGateScreen` linked to `/legal/terms` and `/legal/privacy`,
// the CTA told the farmer that tapping it accepted the Terms of Use, and every acceptance
// wrote `terms-…` and `privacy-…` version strings into an APPEND-ONLY ledger — for two
// documents that had never been written. Those rows cannot be corrected later. This file
// is the alarm that stops that state ever returning.
//
// What each test is really guarding:
//   • existence — a dead link under a button that says "you accept the Terms" is the
//     single most expensive defect in the consent flow, and it is invisible in code review
//     because the <a> tag looks perfectly correct.
//   • retention parity — the numbers live in ONE place (domain/privacy/RetentionPolicy.ts)
//     and are RESTATED in two documents in two languages. Restating is how they drift, so
//     the restatement is pinned rather than trusted.
//   • processor parity — the vendor list is derived from what the backend actually calls.
//     If a new integration lands under `Integrations/**` and nobody updates the notice,
//     the notice starts lying by omission; this fails first.
//   • the AI-training promise — Marathi promised "never" while English promised "not
//     without separate permission". Two farmers on one screen were given different
//     commitments about their own voice. Neither document may carry the qualifier again.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
    RETENTION_DAY_NUMBERS,
    RETENTION_POLICY_VERSION,
} from '../../../domain/privacy/RetentionPolicy';
import {
    PRIVACY_POLICY_VERSION,
    TERMS_VERSION,
} from '../../consent/gate/consentNotice';

/**
 * IMPORTED, not retyped. These are the exact strings the gate writes into the append-only
 * ledger on every acceptance, so the assertion below is the real one: the version the
 * RECORD claims must be the version a SERVED DOCUMENT declares. A local copy of the
 * literal would pass happily while the gate wrote something else entirely — which is
 * precisely the state this suite was written to end.
 */
const TERMS_DOC_VERSION = TERMS_VERSION;
const PRIVACY_DOC_VERSION = PRIVACY_POLICY_VERSION;

const LEGAL_DIR = resolve(__dirname, '../../../../public/legal');

const read = (name: string): string =>
    readFileSync(resolve(LEGAL_DIR, name), 'utf8');

const DOCS = {
    termsEn: read('terms_en.md'),
    termsMr: read('terms_mr.md'),
    privacyEn: read('privacy_en.md'),
    privacyMr: read('privacy_mr.md'),
} as const;

const ALL_DOCS = Object.entries(DOCS);
const PRIVACY_DOCS = [DOCS.privacyEn, DOCS.privacyMr];
const TERMS_DOCS = [DOCS.termsEn, DOCS.termsMr];

/** The Marathi copy writes numerals in Devanagari, as the gate already does for १८. */
const toDevanagariDigits = (n: number): string =>
    String(n).replace(/\d/g, (d) => '०१२३४५६७८९'[Number(d)]);

/** Facts from the public register. The gate deliberately does not show these; §1 must. */
const CIN = 'U62099PN2026PTC256337';
/** Two fragments rather than the whole address: the address wraps across lines in the
 *  rendered markdown, and a test that breaks on a line wrap teaches people to weaken it. */
const OFFICE_FRAGMENTS = ['H. No. 2992', 'Maharashtra – 413304'] as const;
const LEGAL_NAME = 'Agriryot Value Enterprises Private Limited';

/**
 * Every outside company the app actually calls, verified against the repo on 2026-08-17:
 *   AWS            — appsettings `AWS:Region`, RawBlobStoreOptions, RetainedBlobStoreOptions
 *   Sarvam         — Integrations/Sarvam/SarvamOptions.cs (api.sarvam.ai)
 *   Gemini         — Integrations/Gemini/GeminiOptions.cs (generativelanguage.googleapis.com)
 *   Tomorrow.io    — Integrations/Weather/TomorrowIoOptions.cs (api.tomorrow.io/v4)
 *   MSG91          — User.Infrastructure/Otp/Msg91SmsSender.cs (control.msg91.com)
 *   Google Maps    — infrastructure/mapping/googleMapsConfig.ts
 *   Google Fonts   — index.html (fonts.googleapis.com / fonts.gstatic.com)
 *
 * Sentry and the OTLP collector are deliberately ABSENT: both are dependencies whose
 * enabling env var is unset in every build, so naming them would be a fabrication in the
 * other direction. If `VITE_SENTRY_DSN` or `VITE_OTEL_ENABLED=1` is ever wired into a
 * release workflow, this list and both notices gain a row in the same change.
 */
const NAMED_PROCESSORS = [
    'Amazon Web Services',
    'Sarvam AI',
    'Gemini',
    'Tomorrow.io',
    'MSG91',
    'Google Maps Platform',
    'Google Fonts',
] as const;

describe('the legal documents exist at all', () => {
    it('serves four documents — Terms and Privacy, in Marathi and English', () => {
        for (const [name, body] of ALL_DOCS) {
            // A stub, an empty file or a "coming soon" line is the same defect as no file.
            expect(body.length, `${name} is too short to be a real document`)
                .toBeGreaterThan(1500);
        }
    });

    it('says on its face that it is a founder draft, not counsel-reviewed', () => {
        // The honesty header is the price of publishing an unreviewed legal document. It
        // is not decoration and it may not be trimmed for tidiness.
        for (const [name, body] of ALL_DOCS) {
            expect(body, `${name} must carry the LEGAL_REVIEW_PENDING marker for the CI gate`)
                .toContain('LEGAL_REVIEW_PENDING');
            const claimsDraft = body.includes('not been reviewed by a lawyer')
                || body.includes('वकिलांनी अजून तपासलेला नाही');
            expect(claimsDraft, `${name} must state it is an unreviewed draft`).toBe(true);
        }
    });

    it('never claims compliance with the DPDP Act', () => {
        for (const [name, body] of ALL_DOCS) {
            expect(body, `${name} must not claim DPDP compliance`)
                .not.toMatch(/DPDP[- ]compliant|compliant with the Digital Personal Data/i);
        }
    });

    it('declares its own version, so a stored consent can name a document that exists', () => {
        for (const body of TERMS_DOCS) expect(body).toContain(TERMS_DOC_VERSION);
        for (const body of PRIVACY_DOCS) expect(body).toContain(PRIVACY_DOC_VERSION);
    });
});

describe('the privacy notice absorbs what the gate deliberately dropped', () => {
    it('carries the CIN and the registered office the gate took off screen', () => {
        // `OWED_TO_FULL_PRIVACY_NOTICE` in consentNotice.ts names exactly these two as a
        // standing debt. This is the test that closes it — and that stops a later edit
        // quietly dropping them again on the grounds that "the gate doesn't show them".
        for (const body of PRIVACY_DOCS) {
            expect(body).toContain(CIN);
            for (const fragment of OFFICE_FRAGMENTS) expect(body).toContain(fragment);
            expect(body).toContain(LEGAL_NAME);
        }
        // The Terms name the company too — a contract with an unnamed counterparty is not
        // a contract.
        for (const body of TERMS_DOCS) {
            expect(body).toContain(LEGAL_NAME);
            expect(body).toContain(CIN);
        }
    });

    it('keeps the company legal name in Latin script in the Marathi documents', () => {
        // Transliterating a registered name invents a name that is on no register. Same
        // rule the gate already follows for `brandLine`.
        expect(DOCS.privacyMr).toContain(LEGAL_NAME);
        expect(DOCS.termsMr).toContain(LEGAL_NAME);
    });
});

describe('retention — one source of truth, restated in four places', () => {
    it('states the policy version both notices are written against', () => {
        for (const body of PRIVACY_DOCS) expect(body).toContain(RETENTION_POLICY_VERSION);
    });

    it('restates every day-count that RetentionPolicy.ts actually declares', () => {
        // The numbers live in code. If one changes there and not here, this fails — which
        // is the entire reason the numbers are in code at all rather than only in prose.
        expect(RETENTION_DAY_NUMBERS.length).toBeGreaterThan(0);

        for (const days of RETENTION_DAY_NUMBERS) {
            expect(DOCS.privacyEn, `privacy_en.md must state ${days} days`)
                .toContain(String(days));
            expect(DOCS.privacyMr, `privacy_mr.md must state ${toDevanagariDigits(days)} days`)
                .toContain(toDevanagariDigits(days));
        }
    });

    it('does not dress an on-request deletion up as an automatic one', () => {
        // Two rows genuinely have no timer. Saying so is the disclosure; implying a
        // deletion nothing performs is the defect this whole section exists to prevent.
        expect(DOCS.privacyEn).toContain('No automatic deletion date');
        expect(DOCS.privacyMr).toContain('आपोआप नष्ट होण्याची तारीख नाही');
    });
});

describe('processors, and the leg outside India', () => {
    it('names every outside company the app actually calls', () => {
        for (const vendor of NAMED_PROCESSORS) {
            expect(DOCS.privacyEn, `privacy_en.md must name ${vendor}`).toContain(vendor);
            expect(DOCS.privacyMr, `privacy_mr.md must name ${vendor}`).toContain(vendor);
        }
    });

    it('names no processor the code does not actually call', () => {
        // The opposite failure, and just as bad: a notice that names a vendor we never
        // integrated is a fabrication dressed as thoroughness.
        for (const body of PRIVACY_DOCS) {
            expect(body).not.toContain('Sentry');
            expect(body).not.toContain('OpenTelemetry');
        }
    });

    it('states plainly that voice may be processed outside India', () => {
        // Verified in code: GeminiAiProvider base64-encodes the AUDIO STREAM into
        // inline_data on the voice-fallback path — it is not only the transcript that
        // leaves. The registry records Gemini at us-central1.
        expect(DOCS.privacyEn).toContain('processed outside India');
        expect(DOCS.privacyMr).toContain('भारताबाहेर जाऊ शकतो');
    });

    it('admits the processor contracts are not signed yet', () => {
        expect(DOCS.privacyEn).toContain('signed data-processing contracts');
        expect(DOCS.privacyMr).toContain('सहीचा करार');
    });
});

describe('the promises', () => {
    it('promises never to train AI on his voice — with no "unless" in either language', () => {
        // This is the divergence that started the whole exercise. Marathi said never;
        // English said "without separate permission". The strict promise is the one the
        // pilot farmers actually read, so the strict promise is the one that binds, and
        // neither document may reintroduce the qualifier.
        expect(DOCS.privacyEn).toMatch(/will not use your voice to train AI models\./);
        expect(DOCS.privacyEn).not.toMatch(/train AI models without separate permission/);
        expect(DOCS.privacyMr).toContain('तुमचा आवाज AI मॉडेल शिकवण्यासाठी वापरणार नाही');
        expect(DOCS.privacyMr).not.toContain('परवानगीशिवाय AI');
    });

    it('closes the under-18 question in the Terms, in both languages', () => {
        // Founder decision 6. A stated exclusion is the cheap, defensible pilot answer and
        // it is what makes the 18+ tick mean something.
        expect(DOCS.termsEn).toContain('not for anyone under the age of 18');
        expect(DOCS.termsMr).toContain('१८ वर्षांखालील कुणासाठीही नाही');
    });

    it('does not claim the 18+ confirmation is stored, because it is not', () => {
        // Measured 2026-08-17: `AgeDeclaredAdult` travels the whole request path and
        // `RecordConsentGateAcceptanceHandler:56` REFUSES the acceptance without it — but
        // `20260816170524_AddConsentGateLedgers.cs` gives NEITHER ledger table an
        // `age_declared_adult` column, so nothing is ever written down. The first draft of
        // these documents said "that confirmation is recorded with your consent" in all
        // four files. That is the exact failure mode this whole wave exists to stop: a
        // legal document describing a record the software does not keep.
        //
        // The column is owed (it needs a migration, deliberately not scaffolded in this
        // pass). When it lands, this test is what tells the next author to correct the
        // wording in the same change rather than leaving the notices pessimistic.
        for (const [name, body] of ALL_DOCS) {
            expect(body, `${name} must not claim the age tick is stored`)
                .not.toMatch(/confirmation is recorded with|record that confirmation with/);
            expect(body, `${name} must not claim the age tick is stored (mr)`)
                .not.toContain('ती नोंद तुमच्या संमतीसोबत ठेवली जाते');
        }
        // And it must say what IS true — the rule is enforced, the proof is not kept.
        expect(DOCS.privacyEn).toContain('do not yet store that confirmation');
        expect(DOCS.termsEn).toContain('do not yet *store* that confirmation');
        for (const body of [DOCS.privacyMr, DOCS.termsMr]) {
            expect(body).toContain('संमतीच्या नोंदीसोबत साठवली जात नाही');
        }
    });

    it('tells the farmer, in the Terms, that his workers\' names go into the app', () => {
        // Founder decision 9's written half. The spoken half is the onboarding script.
        expect(DOCS.termsEn).toContain('names of the workers and mukadams');
        expect(DOCS.termsMr).toContain('मुकादमांची नावं');
    });

    it('names the Data Protection Board without inventing a channel to reach it', () => {
        for (const body of PRIVACY_DOCS) {
            expect(body).toContain('Data Protection Board of India');
        }
        // No invented portal, form or postal address for the Board — same rule the gate
        // already holds. A farmer would act on an invented channel.
        expect(DOCS.privacyEn).not.toMatch(/Board[^.\n]*https?:\/\//);
        expect(DOCS.privacyMr).not.toMatch(/Board[^.\n]*https?:\/\//);
    });
});
