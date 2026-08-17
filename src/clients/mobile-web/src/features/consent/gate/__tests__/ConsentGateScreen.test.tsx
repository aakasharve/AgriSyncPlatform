// @vitest-environment jsdom
// spec: dfes-companion-2026-07-11 (wave-4.1)
//
// The first-open consent gate. These tests exist to pin the rules a later "let's make
// onboarding smoother" change quietly breaks:
//
//   • ANTI-DARK-PATTERN — the CTA must be reachable by ticking one box and nothing else.
//   • ONE SCROLLER — the gate shipped once with its acceptance bar laid out below the
//     clip of AppShell's fixed, overflow-hidden box, which made the gate impossible to
//     pass on a short phone. jsdom cannot measure that, so the invariant is pinned
//     structurally instead: exactly one scroll container, no sticky/fixed children, and
//     the checkbox and button inside that container. A layout that satisfies those
//     cannot clip its own acceptance.
//   • NO UNFILLED PLACEHOLDERS — what we do not know is omitted, never bracketed.
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
    DATA_FIDUCIARY,
    NOTICE_DATA_CATEGORY_CODES,
    NOTICE_PURPOSE_CODES,
    NOTICE_VERSION,
    OWED_TO_FULL_PRIVACY_NOTICE,
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

        // Nothing else was touched — no scrolling, no timer waited on.
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

describe('ConsentGateScreen — one section, one scroll, acceptance at the end', () => {
    const SCROLL_CLASSES = ['overflow-y-auto', 'overflow-auto', 'overflow-y-scroll', 'overflow-scroll'];

    const scrollers = (container: HTMLElement) =>
        Array.from(container.querySelectorAll('*')).filter((el) =>
            SCROLL_CLASSES.some((c) => el.classList.contains(c)));

    it('has exactly one scroll container, and it is the root', () => {
        const { container } = render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="mr" />);

        const found = scrollers(container);
        expect(found).toHaveLength(1);
        expect(found[0]).toBe(screen.getByTestId('consent-scroll-root'));
    });

    it('parks nothing outside the scroll flow — no sticky or fixed dock to clip against', () => {
        const { container } = render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="mr" />);

        const parked = Array.from(container.querySelectorAll('*')).filter(
            (el) => el.classList.contains('sticky') || el.classList.contains('fixed'));
        expect(parked).toHaveLength(0);
    });

    it('keeps the checkbox and the CTA inside that one scroller, at the end of it', () => {
        render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="mr" />);

        const root = screen.getByTestId('consent-scroll-root');
        const box = screen.getByTestId('consent-age-checkbox');
        const cta = screen.getByTestId('consent-accept-cta');

        // Reachable by scrolling the same column he was already reading.
        expect(root).toContainElement(box);
        expect(root).toContainElement(cta);

        // And they come after the disclosures, not before them.
        const order = Node.DOCUMENT_POSITION_FOLLOWING;
        expect(screen.getByTestId('consent-rights').compareDocumentPosition(cta) & order).toBeTruthy();
        expect(box.compareDocumentPosition(cta) & order).toBeTruthy();
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

    it('shows all five purposes in full, with nothing hidden behind an expander', () => {
        render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="en" />);

        const cards = CONSENT_NOTICE.en.cards;
        expect(cards).toHaveLength(5);

        for (const card of cards) {
            const row = screen.getByTestId(`consent-purpose-card-${card.id}`);
            // Title, the itemised data AND the purpose — visible on arrival.
            expect(row).toHaveTextContent(card.title);
            expect(row).toHaveTextContent(card.data);
            expect(row).toHaveTextContent(card.purpose);
            // Nothing to open. A disclosure behind a tap is one he can miss.
            expect(row.querySelector('[aria-expanded]')).toBeNull();
        }
    });

    it('shows the "what we will not do" panel and the rights summary without expansion', () => {
        render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="en" />);

        const willNot = screen.getByTestId('consent-will-not-do');
        for (const line of CONSENT_NOTICE.en.willNotDo.items) {
            expect(willNot).toHaveTextContent(line);
        }
        // Who may process, and strictly for what — part of the same disclosure.
        expect(willNot).toHaveTextContent(CONSENT_NOTICE.en.processors);

        const rights = screen.getByTestId('consent-rights');
        for (const line of CONSENT_NOTICE.en.rights.items) {
            expect(rights).toHaveTextContent(line);
        }
        expect(rights).toHaveTextContent(CONSENT_NOTICE.en.rights.withdrawal);
    });
});

describe('ConsentGateScreen — who he is dealing with', () => {
    it('names the product, the platform and the company in one line', () => {
        render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="en" />);

        const line = screen.getByTestId('consent-brand-line');
        expect(line).toHaveTextContent('Shram Safal');
        expect(line).toHaveTextContent('AgriSync');
        expect(line).toHaveTextContent('Agriryot Value Enterprises Private Limited');
    });

    it('carries the same three names in the Marathi notice', () => {
        render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="mr" />);

        const line = screen.getByTestId('consent-brand-line');
        expect(line).toHaveTextContent('श्रम सफल');
        expect(line).toHaveTextContent('AgriSync');
        expect(line).toHaveTextContent('Agriryot Value Enterprises Private Limited');
    });

    it('names the company and a way to reach it — the two facts that may never leave', () => {
        render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="mr" />);

        const entity = screen.getByTestId('consent-entity');
        // A farmer has to be able to see WHO is processing his data and HOW to reach
        // them. Strip these and the screen stops being a consent notice.
        expect(entity).toHaveTextContent(DATA_FIDUCIARY.legalName);
        expect(entity).toHaveTextContent(DATA_FIDUCIARY.contact);
    });

    it('keeps the CIN and the registered office OFF the public screen', () => {
        // Founder direction 2026-08-17: corporate-register detail is not what a farmer
        // needs at first open. It is not deleted — it is owed to the full privacy
        // notice, which is why `OWED_TO_FULL_PRIVACY_NOTICE` names both. This test is
        // what stops a later "let's be thorough" edit putting them back.
        for (const language of ['mr', 'en'] as const) {
            const { unmount } = render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage={language} />);
            const body = document.body.textContent ?? '';
            expect(body).not.toContain(DATA_FIDUCIARY.cin);
            expect(body).not.toContain(DATA_FIDUCIARY.registeredOffice);
            unmount();
        }

        expect(OWED_TO_FULL_PRIVACY_NOTICE).toEqual(['cin', 'registeredOffice']);
    });
});

describe('ConsentGateScreen — a printed document, not an app screen', () => {
    // The founder asked for "no extra decorative UI element inside it". These pin the
    // absence, because absence is exactly what a later styling pass restores by reflex.

    it('renders no icon anywhere — not one svg', () => {
        const { container } = render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="mr" />);
        expect(container.querySelectorAll('svg')).toHaveLength(0);
    });

    it('wraps the notice in no card, tile, panel or gradient', () => {
        const { container } = render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="mr" />);

        const decorated = Array.from(container.querySelectorAll('*')).filter((el) =>
            Array.from(el.classList).some((c) =>
                c.startsWith('shadow-')
                || c.startsWith('ring-')
                || c.startsWith('bg-gradient')
                || c.startsWith('backdrop-')
                || c === 'divide-y'));
        expect(decorated).toHaveLength(0);
    });

    it('shows no list markers — the sections are stacked text', () => {
        const { container } = render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="mr" />);

        const lists = Array.from(container.querySelectorAll('ul'));
        expect(lists.length).toBeGreaterThan(0);
        for (const list of lists) expect(list).toHaveClass('list-none');
    });

    it('keeps exactly three interactive controls: switch, checkbox, button', () => {
        const { container } = render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="mr" />);

        // Two language buttons + the CTA. Nothing else is a <button>.
        expect(container.querySelectorAll('button')).toHaveLength(3);
        expect(container.querySelectorAll('input')).toHaveLength(1);
    });

    it('never falls back to system-ui or Arial for visible text', () => {
        const { container } = render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="mr" />);

        const html = container.innerHTML;
        expect(html).not.toContain('system-ui');
        expect(html).not.toContain('Arial');
        // Every text node hangs off a font-sans or font-serif ancestor: the root sets
        // font-sans (DM Sans → Noto Sans Devanagari), headings override to font-serif.
        expect(screen.getByTestId('consent-scroll-root')).toHaveClass('font-sans');
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
    it('shows no unfilled placeholder anywhere — what is unknown is omitted', () => {
        render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="en" />);

        // The old gate rendered a "still to be filled in" panel of empty brackets. It is
        // gone, and no bracketed marker may creep back in: a farmer reading his own
        // consent should never be shown a blank where a fact belongs.
        expect(screen.queryByTestId('consent-pending-disclosures')).toBeNull();

        for (const language of ['mr', 'en'] as const) {
            const notice = canonicalNoticeText(language);
            expect(notice).not.toMatch(/\[[^\]]*\]/);
            expect(notice.toLowerCase()).not.toContain('not yet');
            expect(notice).not.toContain('अद्याप');
        }
    });

    it('carries no नोंद anywhere in the Marathi copy (founder decision 13)', () => {
        expect(canonicalNoticeText('mr')).not.toContain('नोंद');
    });

    it('the canonical text covers what is on screen — every line of every section', () => {
        const canonical = canonicalNoticeText('mr');
        const c = CONSENT_NOTICE.mr;

        // If a section is ever added to the screen and not to canonicalNoticeText, the
        // stored hash silently stops describing the notice. This is that alarm.
        for (const line of [
            c.title, c.intro, c.brandLine, c.purposeCardsHeading, c.willNotDo.heading,
            c.processors, c.rights.heading, c.rights.where, c.rights.withdrawal,
            c.entity.heading, c.acceptanceMeaning, c.ageDeclaration, c.cta,
            c.ctaDisabledHint, c.links.terms, c.links.privacy,
        ]) {
            expect(canonical).toContain(line);
        }
        for (const card of c.cards) {
            expect(canonical).toContain(card.title);
            expect(canonical).toContain(card.data);
            expect(canonical).toContain(card.purpose);
        }
        for (const line of [...c.willNotDo.items, ...c.rights.items]) {
            expect(canonical).toContain(line);
        }
        // The data fiduciary is part of the notice: a notice naming a different company
        // is a different notice, and the record has to be able to tell them apart.
        expect(canonical).toContain(DATA_FIDUCIARY.legalName);
        expect(canonical).toContain(DATA_FIDUCIARY.contact);
    });

    it('does not hash facts the farmer was never shown', () => {
        // The hash has to describe the SCREEN. The CIN and the office came off the
        // screen, so they came out of the serialisation in the same commit — otherwise
        // the stored record would assert he was told something he was not.
        for (const language of ['mr', 'en'] as const) {
            const canonical = canonicalNoticeText(language);
            expect(canonical).not.toContain(DATA_FIDUCIARY.cin);
            expect(canonical).not.toContain(DATA_FIDUCIARY.registeredOffice);
        }
    });

    it('moved the version when the words moved', () => {
        // A farmer who accepted the previous wording must not be recorded against this
        // one. The gate re-shows on a version change (useConsentGate), so this string
        // changing IS the re-consent mechanism.
        expect(NOTICE_VERSION).toBe('notice-2026-08-17.2');
    });

    it('a different displayed language is a different notice, and so a different hash', () => {
        expect(canonicalNoticeText('mr')).not.toBe(canonicalNoticeText('en'));
    });
});
