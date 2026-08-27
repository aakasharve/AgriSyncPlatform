/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment jsdom
 *
 * The two headline components, and the one ruling each of them encodes.
 *
 * `SavedLocallyHeadline` — USES THE SHORT CLAIM, NOT THE LONG SENTENCE.
 * `sync.onPhoneFull` was drafted for this slot and measured against it; the
 * short form came in at 190.42px on ONE line, 34px narrower than the "Saved to
 * Ledger" it replaces, with 0px fold movement, and the long form was NOT
 * authorised. Both strings are valid copy, so nothing about types or i18n stops
 * someone swapping one for the other — this test is the only thing that does.
 *
 * `ShramSathiUnderstanding` — FIRST PERSON, and in the farmer's language. It
 * replaced "Your Shram sathi is trying to understand what work you did
 * today...": English on a Marathi-first surface, and third person about a
 * character who speaks in the first person everywhere else.
 *
 * spec: 2026-08-12-labour-phase2-server-truth-farm-context
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { t as translate, type Language } from '../../../i18n/translations';

const langRef = { current: 'mr' as Language };

vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({
        language: langRef.current,
        setLanguage: (next: Language) => { langRef.current = next; },
        t: (key: string) => translate(key, langRef.current),
    }),
}));

import { SavedLocallyHeadline, ShramSathiUnderstanding } from '../mainViewComponents';
import { SYNC_HONESTY_I18N_KEYS } from '../../../features/sync/status/syncHonestyState';

afterEach(() => {
    cleanup();
    langRef.current = 'mr';
});

describe('SavedLocallyHeadline — the post-save claim', () => {
    it('renders the SHORT phone claim, the measured one', () => {
        render(<SavedLocallyHeadline />);
        expect(screen.getByRole('heading'))
            .toHaveTextContent(translate(SYNC_HONESTY_I18N_KEYS.ON_PHONE, 'mr'));
    });

    it('does NOT render the long form, which was not authorised here', () => {
        // The regression this exists to catch: both strings are correct copy,
        // so a swap type-checks, renders, reads well — and silently costs the
        // measurement the headline was signed off against.
        render(<SavedLocallyHeadline />);
        expect(screen.getByRole('heading'))
            .not.toHaveTextContent(translate('sync.onPhoneFull', 'mr'));
    });

    it('keeps text-3xl, the size the fallback was measured at', () => {
        render(<SavedLocallyHeadline />);
        expect(screen.getByRole('heading').className).toContain('text-3xl');
    });

    it('never claims the farm records — that is ON_SERVER\'s to make', () => {
        // At this instant the record is on the handset and nothing has been
        // acknowledged. "Kept in your farm records" here is the false
        // reassurance Phase 1 exists to destroy (`B5`).
        render(<SavedLocallyHeadline />);
        const heading = screen.getByRole('heading');
        expect(heading).not.toHaveTextContent(translate(SYNC_HONESTY_I18N_KEYS.ON_SERVER, 'mr'));
        expect(heading).not.toHaveTextContent('शेतनोंदीत');
    });

    it('no longer says "Saved to Ledger", which claimed the ledger', () => {
        render(<SavedLocallyHeadline />);
        expect(screen.getByRole('heading')).not.toHaveTextContent('Saved to Ledger');
    });

    it('follows the farmer language', () => {
        langRef.current = 'en';
        render(<SavedLocallyHeadline />);
        expect(screen.getByRole('heading'))
            .toHaveTextContent(translate(SYNC_HONESTY_I18N_KEYS.ON_PHONE, 'en'));
    });
});

describe('ShramSathiUnderstanding — the processing line', () => {
    it('speaks in the first person in Marathi', () => {
        render(<ShramSathiUnderstanding />);
        const heading = screen.getByRole('heading');
        expect(heading).toHaveTextContent(translate('shramSathi.understanding', 'mr'));
        expect(heading.textContent?.startsWith('मी')).toBe(true);
    });

    it('is not the old third-person English line', () => {
        render(<ShramSathiUnderstanding />);
        expect(screen.getByRole('heading')).not.toHaveTextContent('Your Shram sathi');
    });

    it('uses the name, not a bare "I", in English', () => {
        // Deliberate asymmetry: in English a bare first person from an unnamed
        // app reads as the app, not as the character. Marathi carries the
        // persona in the verb ending.
        langRef.current = 'en';
        render(<ShramSathiUnderstanding />);
        expect(screen.getByRole('heading')).toHaveTextContent('Shram Sathi');
    });
});
