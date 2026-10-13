// spec: 2026-08-25-prod-cutover-waves
//
// NO INTERNAL REVIEW MARKER MAY REACH A USER, AND THE WORDS MUST NOT OVERSTATE WHAT THE
// SOFTWARE DOES.
//
// Until this change the four legal i18n bundles wrapped every string in a helper that
// prepended a literal review tag, so farmers read it in front of the Voice Diary labels
// and the consent and data-rights screens. The tag was removed. This file is the alarm
// that stops it coming back, in ANY locale and in ANY served document.
//
// Removing a tag is not a review: copy review status lives in the private review records
// and is NOT approved by this test passing. The second half pins a handful of statements
// that were measured against the code and found untrue (see the per-test notes), so a
// later edit cannot quietly reintroduce an overstated promise.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CONSENT_BUNDLES } from '../consentTranslations';
import { DATA_RIGHTS_BUNDLES } from '../dataRightsTranslations';
import { PII_REVIEW_BUNDLES } from '../piiReviewTranslations';
import { VOICE_DIARY_BUNDLES } from '../voiceDiaryTranslations';
import { translations } from '../translations';
import { CONSENT_NOTICE, canonicalNoticeText } from '../../features/consent/gate/consentNotice';

// Built by concatenation on purpose: .github/workflows/legal-review-gate.yml counts the
// literal token under src/, and a test that spells it out would put a permanent
// false positive in that count. No test file in this app spells the token out.
const MARKER = 'LEGAL_REVIEW' + '_PENDING';

/** Every string value reachable from `node`, with its dotted path. */
function collectStrings(node: unknown, path: string, out: Array<[string, string]>): void {
    if (typeof node === 'string') {
        out.push([path, node]);
    } else if (Array.isArray(node)) {
        node.forEach((v, i) => collectStrings(v, `${path}[${i}]`, out));
    } else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) collectStrings(v, path ? `${path}.${k}` : k, out);
    }
}

const BUNDLES: Record<string, unknown> = {
    consent: CONSENT_BUNDLES,
    dataRights: DATA_RIGHTS_BUNDLES,
    piiReview: PII_REVIEW_BUNDLES,
    voiceDiary: VOICE_DIARY_BUNDLES,
    appTranslations: translations,
    consentGateNotice: CONSENT_NOTICE,
};

describe('no user-visible string carries an internal review marker', () => {
    for (const [name, bundle] of Object.entries(BUNDLES)) {
        it(`${name}: no string in any locale contains ${MARKER}`, () => {
            const strings: Array<[string, string]> = [];
            collectStrings(bundle, name, strings);
            expect(strings.length).toBeGreaterThan(0);
            for (const [path, value] of strings) {
                expect(value, `${path} must not carry a review marker`).not.toContain(MARKER);
            }
        });
    }

    it('covers all three locales of the legal bundles (mr-IN, hi-IN, en-IN)', () => {
        for (const bundle of [CONSENT_BUNDLES, DATA_RIGHTS_BUNDLES, PII_REVIEW_BUNDLES, VOICE_DIARY_BUNDLES]) {
            expect(Object.keys(bundle).sort()).toEqual(['en-IN', 'hi-IN', 'mr-IN']);
        }
    });

    it('the hashed consent notice text carries no marker in either language', () => {
        // The notice hash covers canonicalNoticeText, so the marker must never enter it.
        for (const lang of ['mr', 'en'] as const) {
            expect(canonicalNoticeText(lang)).not.toContain(MARKER);
        }
    });

    it('no served document under public/ carries the marker', () => {
        const root = resolve(__dirname, '../../../public');
        const hits: string[] = [];
        const walk = (dir: string): void => {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) walk(full);
                else if (/\.(md|txt|json|html|svg)$/i.test(entry) && readFileSync(full, 'utf8').includes(MARKER)) {
                    hits.push(full);
                }
            }
        };
        walk(join(root, 'consent'));
        walk(join(root, 'legal'));
        expect(hits).toEqual([]);
    });

    it('no shipped source file builds the runtime prefix any more', () => {
        const srcRoot = resolve(__dirname, '../..');
        const hits: string[] = [];
        const walk = (dir: string): void => {
            for (const entry of readdirSync(dir)) {
                if (entry === '__tests__' || entry === 'node_modules') continue;
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) walk(full);
                else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) {
                    const body = readFileSync(full, 'utf8');
                    if (body.includes(`[${MARKER}]`) || body.includes('tagLegalString')) hits.push(full);
                }
            }
        };
        walk(srcRoot);
        expect(hits).toEqual([]);
    });
});

describe('statements that were measured against the code and found untrue stay out', () => {
    const allLegal: Array<[string, string]> = [];
    collectStrings(
        { c: CONSENT_BUNDLES, d: DATA_RIGHTS_BUNDLES, v: VOICE_DIARY_BUNDLES },
        '',
        allLegal,
    );
    const en = allLegal.filter(([p]) => /en-IN/.test(p));

    it('does not promise an hour count for erasure or export', () => {
        // ErasureWorker polls every 60s but nothing enforces a deadline; ExportWorker cannot
        // issue a download link at all (ExportWorker.NoSignerReason).
        for (const [path, value] of allLegal.filter(([p]) => /\.(erasure|export)\./.test(p))) {
            expect(value, path).not.toMatch(/\b(24|48)\s*(hours?|घंटों?)|२४|४८/);
        }
    });

    it('does not claim end-to-end encryption, or that recordings auto-delete after 30 days', () => {
        // The live writer stores the clip unsealed and purgeExpiredProcessingVoiceClips is a
        // no-op (founder ruling D9); nothing deletes a recording on a timer.
        for (const [path, value] of en) {
            expect(value, path).not.toMatch(/end-to-end/i);
            expect(value, path).not.toMatch(/auto-?delete|(deleted automatically|automatically deleted) after/i);
            expect(value, path).not.toMatch(/30 days only/i);
        }
    });

    it('does not say revoking makes older recordings unplayable', () => {
        // GetVoiceDiaryByRangeHandler has no consent gate: saved clips stay listed after
        // a revoke, and the stop-saving confirmation already says so.
        const whatStops = CONSENT_BUNDLES['en-IN'].revoke.whatStops;
        expect(whatStops).not.toMatch(/no longer be able to play/i);
        expect(whatStops).toMatch(/already saved stay/i);
    });

    it('does not cite a statute as if it were a compliance statement', () => {
        for (const [path, value] of allLegal) {
            expect(value, path).not.toMatch(/DPDP/);
        }
    });
});
