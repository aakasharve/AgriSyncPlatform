// @vitest-environment jsdom
// spec: dfes-companion-2026-07-11 (wave-4.1)
//
// The first-open consent gate. These tests exist to pin the ANTI-DARK-PATTERN rules,
// because those are the rules a later "let's make onboarding smoother" change quietly
// breaks: the CTA must be reachable by ticking one box and nothing else.
//
// Per repo convention the global vitest env stays 'node'; this file opts into jsdom
// above and imports jest-dom matchers per-file.

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// LanguageContext reads Dexie; stub it so a unit test never drags IndexedDB in.
// `language` is driven by the stub's own state so the switcher can be exercised.
let stubLanguage: 'en' | 'mr' = 'mr';
vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({
        language: stubLanguage,
        setLanguage: (l: 'en' | 'mr') => { stubLanguage = l; },
        t: (k: string) => k,
    }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import ConsentGateScreen from '../ConsentGateScreen';
import {
    CONSENT_NOTICE,
    NOTICE_DATA_CATEGORY_CODES,
    NOTICE_PURPOSE_CODES,
    NOTICE_VERSION,
    canonicalNoticeText,
} from '../consentNotice';
import { CORE_PURPOSE_CODES, OPTIONAL_PURPOSE_CODES } from '../../../../domain/consent/CoreConsentScope';

afterEach(() => {
    cleanup();
    stubLanguage = 'mr';
});

describe('ConsentGateScreen — the 18+ gate', () => {
    it('disables the CTA until the age declaration is ticked, and enables it on that alone', () => {
        render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="mr" />);

        const cta = screen.getByTestId('consent-accept-cta');
        expect(cta).toBeDisabled();

        fireEvent.click(screen.getByTestId('consent-age-checkbox'));

        // Nothing else was touched — no scrolling, no card expanded, no timer waited on.
        expect(cta).toBeEnabled();
    });

    it('never fires acceptance while the box is unticked', () => {
        const onAccept = vi.fn();
        render(<ConsentGateScreen onAccept={onAccept} forceLanguage="mr" />);

        fireEvent.click(screen.getByTestId('consent-accept-cta'));

        expect(onAccept).not.toHaveBeenCalled();
    });

    it('un-ticking the box disables the CTA again', () => {
        render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="mr" />);
        const box = screen.getByTestId('consent-age-checkbox');

        fireEvent.click(box);
        expect(screen.getByTestId('consent-accept-cta')).toBeEnabled();
        fireEvent.click(box);
        expect(screen.getByTestId('consent-accept-cta')).toBeDisabled();
    });
});

describe('ConsentGateScreen — no dark patterns', () => {
    it('starts every checkbox on the screen unticked, and there is exactly one', () => {
        const { container } = render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="mr" />);
        const boxes = Array.from(container.querySelectorAll('input[type="checkbox"]'));

        // One box: the mandatory age declaration. Optional purposes are NOT offered here
        // at all — they are default-off and live in Settings (wave-4.3), which is the
        // only shape that keeps core consent purpose-limited.
        expect(boxes).toHaveLength(1);
        expect(boxes.every((b) => !(b as HTMLInputElement).checked)).toBe(true);
    });

    it('offers no optional purpose on the gate — core consent is closed', () => {
        render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="en" />);
        const body = document.body.textContent ?? '';

        for (const optional of OPTIONAL_PURPOSE_CODES) {
            expect(body).not.toContain(optional);
        }
    });

    it('the five data-purpose cards are all collapsed on arrival and expand independently', () => {
        render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="mr" />);

        const ids = CONSENT_NOTICE.mr.cards.map((c) => c.id);
        expect(ids).toHaveLength(5);

        for (const id of ids) {
            const card = screen.getByTestId(`consent-purpose-card-${id}`);
            expect(card.querySelector('button')).toHaveAttribute('aria-expanded', 'false');
        }

        const first = screen.getByTestId(`consent-purpose-card-${ids[0]}`);
        fireEvent.click(first.querySelector('button') as HTMLElement);
        expect(first.querySelector('button')).toHaveAttribute('aria-expanded', 'true');
        // Expanding one does not expand the rest, and does not gate anything.
        const second = screen.getByTestId(`consent-purpose-card-${ids[1]}`);
        expect(second.querySelector('button')).toHaveAttribute('aria-expanded', 'false');
    });

    it('shows the "what we will not do" panel and the rights summary without expansion', () => {
        render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="en" />);

        const willNot = screen.getByTestId('consent-will-not-do');
        for (const line of CONSENT_NOTICE.en.willNotDo.items) {
            expect(willNot).toHaveTextContent(line);
        }
        const rights = screen.getByTestId('consent-rights');
        for (const line of CONSENT_NOTICE.en.rights.items) {
            expect(rights).toHaveTextContent(line);
        }
    });
});

describe('ConsentGateScreen — language', () => {
    it('renders the notice in Marathi and switches to English', () => {
        const { rerender } = render(<ConsentGateScreen onAccept={vi.fn()} />);
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(CONSENT_NOTICE.mr.title);

        fireEvent.click(screen.getByText('English'));
        rerender(<ConsentGateScreen onAccept={vi.fn()} />);

        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(CONSENT_NOTICE.en.title);
    });

    it('uses the serif Devanagari face for Marathi headings and DM Sans for English', () => {
        const { unmount } = render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="mr" />);
        expect(screen.getByRole('heading', { level: 1 }).className).toContain('font-serif');
        unmount();

        render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="en" />);
        expect(screen.getByRole('heading', { level: 1 }).className).toContain('font-sans');
    });
});

describe('ConsentGateScreen — what the tap hands over', () => {
    it('reports the displayed language, both versions, the codes, and the exact notice', async () => {
        const onAccept = vi.fn();
        render(<ConsentGateScreen onAccept={onAccept} forceLanguage="mr" />);

        fireEvent.click(screen.getByTestId('consent-age-checkbox'));
        fireEvent.click(screen.getByTestId('consent-accept-cta'));

        await waitFor(() => expect(onAccept).toHaveBeenCalledTimes(1));
        const payload = onAccept.mock.calls[0][0];

        expect(payload.displayedLanguage).toBe('mr');
        expect(payload.noticeVersion).toBe(NOTICE_VERSION);
        expect(payload.ageDeclaredAdult).toBe(true);
        expect(payload.purposeCodes).toEqual(NOTICE_PURPOSE_CODES);
        expect(payload.dataCategoryCodes).toEqual(NOTICE_DATA_CATEGORY_CODES);
        // The hash wave-4.2 stores is taken over THIS string, so it has to be the
        // Marathi notice — the one that was actually on screen — not the default.
        expect(payload.canonicalNotice).toBe(canonicalNoticeText('mr'));
    });

    it('grants exactly the core purposes and nothing more', () => {
        expect(NOTICE_PURPOSE_CODES).toEqual(CORE_PURPOSE_CODES);
    });

    it('stays on the gate and says so when the record cannot be written', async () => {
        const onAccept = vi.fn().mockRejectedValue(new Error('offline'));
        render(<ConsentGateScreen onAccept={onAccept} forceLanguage="mr" />);

        fireEvent.click(screen.getByTestId('consent-age-checkbox'));
        fireEvent.click(screen.getByTestId('consent-accept-cta'));

        await waitFor(() => expect(screen.getByTestId('consent-failed')).toBeInTheDocument());
        // Still enabled — he can try again. Never a silent pass.
        expect(screen.getByTestId('consent-accept-cta')).toBeEnabled();
    });
});

describe('the notice document', () => {
    it('renders every founder-owed disclosure as a visible unfilled placeholder', () => {
        render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="en" />);
        const panel = screen.getByTestId('consent-pending-disclosures');

        // Six, exactly — the founder's own list. If one is filled in, its placeholder
        // marker goes with it and this count is the thing that notices.
        expect(CONSENT_NOTICE.en.pendingDisclosures.items).toHaveLength(6);
        for (const line of CONSENT_NOTICE.en.pendingDisclosures.items) {
            expect(panel).toHaveTextContent(line);
        }
    });

    it('carries no नोंद anywhere in the Marathi copy (founder decision 13)', () => {
        expect(canonicalNoticeText('mr')).not.toContain('नोंद');
    });

    it('the canonical text covers what is on screen — every heading and every card line', () => {
        const canonical = canonicalNoticeText('mr');
        const c = CONSENT_NOTICE.mr;

        // If a section is ever added to the screen and not to canonicalNoticeText, the
        // stored hash silently stops describing the notice. This is that alarm.
        for (const line of [
            c.title, c.intro, c.purposeCardsHeading, c.willNotDo.heading, c.rights.heading,
            c.rights.where, c.acceptanceMeaning, c.ageDeclaration, c.cta, c.ctaDisabledHint,
            c.pendingDisclosures.heading, c.pendingDisclosures.note, c.links.terms, c.links.privacy,
        ]) {
            expect(canonical).toContain(line);
        }
        for (const card of c.cards) {
            expect(canonical).toContain(card.title);
            expect(canonical).toContain(card.summary);
            expect(canonical).toContain(card.why);
            for (const collected of card.collects) expect(canonical).toContain(collected);
        }
        for (const line of [...c.willNotDo.items, ...c.rights.items, ...c.pendingDisclosures.items]) {
            expect(canonical).toContain(line);
        }
    });

    it('a different displayed language is a different notice, and so a different hash', () => {
        expect(canonicalNoticeText('mr')).not.toBe(canonicalNoticeText('en'));
    });
});
