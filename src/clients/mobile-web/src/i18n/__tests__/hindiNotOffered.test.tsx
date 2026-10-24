// @vitest-environment jsdom
/**
 * spec: 2026-08-25-prod-cutover-waves
 *
 * Hindi was never requested. The app offers Marathi and English only, and a
 * 'hi' that reaches the client from an old stored preference or an old server
 * row falls back to Marathi (the app default), never to a Hindi bundle, a
 * crash, or English by accident.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const setLanguage = vi.fn();
vi.mock('../LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
let preferred: string | undefined = 'hi';
vi.mock('../../core/session/FarmContext', () => ({
    useFarmContext: () => ({ meContext: { me: { preferredLanguage: preferred } } }),
}));

import { LanguageSyncFromServer } from '../LanguageSyncFromServer';
import { toConsentLocale, CONSENT_BUNDLES } from '../consentTranslations';
import { toDataRightsLocale, DATA_RIGHTS_BUNDLES } from '../dataRightsTranslations';
import { toPiiReviewLocale, PII_REVIEW_BUNDLES } from '../piiReviewTranslations';
import { toVoiceDiaryLocale, VOICE_DIARY_BUNDLES } from '../voiceDiaryTranslations';

describe('Hindi is not offered', () => {
    it.each([toConsentLocale, toDataRightsLocale, toPiiReviewLocale, toVoiceDiaryLocale])(
        "a stored or server-sent 'hi' / 'hi-IN' falls back to Marathi; unknown stays English",
        resolve_ => {
            expect(resolve_('hi')).toBe('mr-IN');
            expect(resolve_('hi-IN')).toBe('mr-IN');
            expect(resolve_('mr')).toBe('mr-IN');
            expect(resolve_('en')).toBe('en-IN');
            expect(resolve_('xx')).toBe('en-IN');
            expect(resolve_(null)).toBe('en-IN');
        },
    );

    it('no bundle carries a Hindi locale', () => {
        for (const bundle of [CONSENT_BUNDLES, DATA_RIGHTS_BUNDLES, PII_REVIEW_BUNDLES, VOICE_DIARY_BUNDLES]) {
            expect(Object.keys(bundle)).not.toContain('hi-IN');
        }
    });

    it("LanguageSyncFromServer maps a server preference of 'hi' to Marathi", async () => {
        preferred = 'hi';
        setLanguage.mockClear();
        render(<LanguageSyncFromServer />);
        await waitFor(() => expect(setLanguage).toHaveBeenCalledWith('mr'));
        expect(screen.queryByText(/./)).toBeNull();
    });

    it('the Hindi consent agreement is no longer shipped to the client', () => {
        const dir = resolve(__dirname, '../../../public/consent');
        expect(existsSync(resolve(dir, 'agreement_hi.md'))).toBe(false);
        expect(readFileSync(resolve(dir, 'agreement_mr.md'), 'utf8')).toContain('संमती');
    });
});
