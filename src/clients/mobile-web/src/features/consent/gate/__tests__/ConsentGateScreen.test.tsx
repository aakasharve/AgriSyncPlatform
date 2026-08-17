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

describe('ConsentGateScreen — inside the app frame, not its own', () => {
    // Founder, 2026-08-17: the screen "seems like other part of UI". It had invented its
    // own column and its own paper. These pin the two facts that made it foreign — a
    // hand-rolled width and a white background — so the next styling pass cannot
    // reintroduce either without tripping a test.

    it('uses the app-wide content column, not a width of its own', () => {
        render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="mr" />);
        const root = screen.getByTestId('consent-scroll-root');

        // `page-content` (styles/global-theme.css) is what AppHeader and AppContent's
        // <main> use: 480 / 600 ≥768 / 640 ≥1280 with 16px gutters. Carrying the class
        // rather than a max-w-[…] is the point — the number lives in ONE place.
        expect(root).toHaveClass('page-content');
        expect(Array.from(root.classList).some((c) => c.startsWith('max-w-'))).toBe(false);
    });

    it('paints no background of its own — it sits on AppShell\'s surface', () => {
        const { container } = render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="mr" />);

        // AppShell's column is bg-surface-100 (#FAFAF9) and screens inherit it; <main>
        // declares no background either. A bg-white root was a white rectangle on the
        // app's warm paper, which is most of why the screen read as a different app.
        const painted = Array.from(container.querySelectorAll('*')).filter((el) =>
            el.classList.contains('bg-white'));
        expect(painted).toHaveLength(0);
    });

    it('pays the bottom inset only — AppShell already pays top and sides', () => {
        render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="mr" />);
        const root = screen.getByTestId('consent-scroll-root');

        // Re-paying pl/pr-safe-area here would double-inset the text on a notched phone,
        // because AppShell's children slot already carries them.
        const inner = root.firstElementChild as HTMLElement;
        expect(root.className).not.toContain('safe-area');
        expect(inner.className).not.toContain('pl-safe');
        expect(inner.className).toContain('safe-area-inset-bottom');
    });
});

describe('ConsentGateScreen — there is a way to say no', () => {
    it('offers a decline at the same size and width as the accept', () => {
        render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="mr" />);

        const accept = screen.getByTestId('consent-accept-cta');
        const decline = screen.getByTestId('consent-decline');

        // Equal prominence is the requirement, and it is measurable: same type size,
        // same full width. Plain text vs filled is allowed; smaller or hidden is not.
        expect(decline).toHaveTextContent(CONSENT_NOTICE.mr.decline.label);
        expect(decline.className).toContain('text-[14px]');
        expect(accept.className).toContain('text-[14px]');
        expect(decline.className).toContain('w-full');
        // And it is never disabled — refusing is available before the box is ticked.
        expect(decline).toBeEnabled();
        expect(accept).toBeDisabled();
    });

    it('explains what declining costs, and records nothing', () => {
        const onAccept = vi.fn();
        render(<ConsentGateScreen onAccept={onAccept} forceLanguage="en" />);

        expect(screen.queryByTestId('consent-declined-consequence')).toBeNull();
        fireEvent.click(screen.getByTestId('consent-decline'));

        expect(screen.getByTestId('consent-declined-consequence'))
            .toHaveTextContent(CONSENT_NOTICE.en.decline.consequence);
        // Nothing is written. Not the acceptance callback, not a denial — the gate runs
        // before any account exists, so a refusal could only be keyed to a device id we
        // minted ourselves, and storing that is the processing he just refused.
        expect(onAccept).not.toHaveBeenCalled();
    });

    it('leaves him exactly where he can reconsider', () => {
        render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="mr" />);

        fireEvent.click(screen.getByTestId('consent-decline'));

        // No silent exit, no reload into the same screen with no explanation. The
        // checkbox and the CTA are still on screen and still work.
        const box = screen.getByTestId('consent-age-checkbox');
        expect(box).toBeInTheDocument();
        fireEvent.click(box);
        expect(screen.getByTestId('consent-accept-cta')).toBeEnabled();
    });

    it('carries the decline copy in both languages, and in the hash', () => {
        for (const language of ['mr', 'en'] as const) {
            const copy = CONSENT_NOTICE[language].decline;
            expect(copy.label.length).toBeGreaterThan(0);
            // The consequence is a disclosure about the consent, so the stored hash has
            // to cover it — otherwise the record cannot say what he was told refusing
            // would mean.
            expect(canonicalNoticeText(language)).toContain(copy.label);
            expect(canonicalNoticeText(language)).toContain(copy.consequence);
        }
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

    it('tells him he can complain to the Data Protection Board, in both languages', () => {
        // DPDP Act 2023 §5(1) requires the notice to inform him of three things. It had
        // two: the data and purposes, and how to exercise his rights with us. §5(1)(c) —
        // the manner of complaining to the Board — was missing entirely.
        for (const language of ['en', 'mr'] as const) {
            const { unmount } = render(
                <ConsentGateScreen onAccept={vi.fn()} forceLanguage={language} />);

            const rights = screen.getByTestId('consent-rights');
            expect(rights).toHaveTextContent(CONSENT_NOTICE[language].rights.boardComplaint);
            // The Board is named, so the farmer knows who he is entitled to go to.
            expect(rights).toHaveTextContent('Data Protection Board of India');

            unmount();
        }
    });

    it('names no Board address, inbox or portal, because none is verified', () => {
        // Stating the right is the disclosure. Inventing the mechanism would be worse
        // than omitting it — he would act on a channel that does not exist.
        for (const language of ['en', 'mr'] as const) {
            const line = CONSENT_NOTICE[language].rights.boardComplaint;
            expect(line).not.toMatch(/https?:\/\//);
            expect(line).not.toMatch(/@/);
            expect(line).not.toMatch(/\b\d{6}\b/); // a PIN code would mean a postal address
        }
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

    it('wraps the notice in no card, tile or panel — and the one gradient is the backdrop, not decoration', () => {
        const { container } = render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="mr" />);

        // Founder direction 2026-08-17 (fourth): a backdrop is not decoration INSIDE the
        // document — it is the world the document sits in. `consent-scroll-root` is the
        // screen's own frame (LoginPage's exact gradient, so the two pre-login screens
        // read as one app); every element inside that frame still carries none of these.
        const decorated = Array.from(container.querySelectorAll('*')).filter((el) =>
            el.getAttribute('data-testid') !== 'consent-scroll-root'
            && Array.from(el.classList).some((c) =>
                c.startsWith('shadow-')
                || c.startsWith('ring-')
                || c.startsWith('bg-gradient')
                || c.startsWith('backdrop-')
                || c === 'divide-y'));
        expect(decorated).toHaveLength(0);

        const root = screen.getByTestId('consent-scroll-root');
        expect(root).toHaveClass('bg-gradient-to-b', 'from-emerald-50/60', 'via-white', 'to-emerald-50/40');
    });

    it('shows no list markers — the sections are stacked text', () => {
        const { container } = render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="mr" />);

        const lists = Array.from(container.querySelectorAll('ul'));
        expect(lists.length).toBeGreaterThan(0);
        for (const list of lists) expect(list).toHaveClass('list-none');
    });

    it('keeps exactly four interactive controls: switch, checkbox, accept, decline', () => {
        const { container } = render(<ConsentGateScreen onAccept={vi.fn()} forceLanguage="mr" />);

        // Two language buttons + accept + decline. Nothing else is a <button>. The
        // decline arrived on 2026-08-17 and is the ONLY control added since the
        // plain-document pass; anything beyond four is chrome creeping back.
        expect(container.querySelectorAll('button')).toHaveLength(4);
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
            c.rights.boardComplaint,
            c.entity.heading, c.acceptanceMeaning, c.ageDeclaration, c.cta,
            c.ctaDisabledHint, c.decline.label, c.decline.consequence,
            c.links.terms, c.links.privacy,
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
        // changing IS the re-consent mechanism. `.5` = English aligned up to the Marathi
        // absolute on AI training, AND the Terms/Privacy versions moved to documents that
        // exist; anyone who accepted `.4` was shown a weaker English promise and two
        // version strings that named nothing.
        expect(NOTICE_VERSION).toBe('notice-2026-08-17.5');
    });

    // The other half of `.5` — that TERMS_VERSION and PRIVACY_POLICY_VERSION name
    // documents which actually declare those versions — is pinned in
    // `features/legal/__tests__/legalDocuments.test.ts`, which imports both constants and
    // reads the four served files. It lives there rather than here because this file runs
    // under jsdom to render a component, and reaching into `public/` from a component
    // test is how a UI suite quietly becomes a filesystem suite.

    it('makes ONE promise about his voice and AI, not one per language', () => {
        // The divergence this test exists for: Marathi promised never, English promised
        // "not without separate permission", and `canonicalNoticeText` hashes each
        // language separately — so the ledger held two materially different, separately
        // enforceable commitments about the same voice, under one version, with the
        // farmers who matter reading the strict one.
        //
        // Aligning English UP is also the only line that is TRUE of the code: nothing in
        // the app can grant voice-training consent. `VerbatimTrainingCorpus` exists on
        // UserConsentState but is reachable by no endpoint and no screen, and both jobs
        // that could build a training set are off by default and enabled nowhere.
        expect(CONSENT_NOTICE.en.willNotDo.items[2])
            .toBe('We will not use your voice to train AI models.');
        expect(CONSENT_NOTICE.mr.willNotDo.items[2])
            .toBe('तुमचा आवाज AI मॉडेल शिकवण्यासाठी वापरणार नाही.');

        // No "unless" may creep back into either. A qualifier on one side only is exactly
        // how the two drifted apart the first time.
        for (const language of ['mr', 'en'] as const) {
            const line = CONSENT_NOTICE[language].willNotDo.items[2];
            expect(line).not.toContain('without separate permission');
            expect(line).not.toContain('परवानगीशिवाय');
            // And it is hashed, so the record can prove which promise was on screen.
            expect(canonicalNoticeText(language)).toContain(line);
        }
    });

    it('a different displayed language is a different notice, and so a different hash', () => {
        expect(canonicalNoticeText('mr')).not.toBe(canonicalNoticeText('en'));
    });
});
