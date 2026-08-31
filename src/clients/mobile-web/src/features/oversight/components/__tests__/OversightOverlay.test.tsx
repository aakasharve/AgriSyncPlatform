// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop (Task 14, change 9)
 *
 * Pins `OversightOverlay` as its OWN component boundary — the founder's
 * complaint was that the oversight "page" was merged into `AppHeader.tsx`'s
 * own JSX rather than being a distinct surface with a navigation trigger
 * pointing at it. These tests exercise the component directly (not through
 * `AppHeader`), which `AppHeader.oversight.test.tsx`'s existing suite
 * already covers end-to-end via the SAME testids this file pins.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import type { Language } from '../../../../i18n/language';
import { oversightTranslations } from '../../../../i18n/oversightTranslations';
import { dataFreshnessTranslations } from '../../../../i18n/dataFreshnessTranslations';
import type { OversightModel } from '../../oversightSelectors';
import OversightOverlay from '../OversightOverlay';

afterEach(() => {
    cleanup();
});

const emptyModel: OversightModel = {
    people: [],
    unattributed: null,
    totalRecords: 0,
    totalPlots: 0,
    decisions: [],
    waitingCount: 0,
    sinceDays: null,
    boundaryApproximate: true,
};

function baseProps(overrides: Partial<React.ComponentProps<typeof OversightOverlay>> = {}) {
    return {
        isOpen: true,
        language: 'mr' as Language,
        model: emptyModel,
        status: 'idle' as const,
        onAcknowledge: vi.fn(),
        onClose: vi.fn(),
        ...overrides,
    };
}

describe('OversightOverlay — a distinct surface, not inline AppHeader JSX', () => {
    it('renders nothing at all when closed', () => {
        render(<OversightOverlay {...baseProps({ isOpen: false })} />);
        expect(screen.queryByTestId('waiting-drawer-sheet')).not.toBeInTheDocument();
    });

    it('portals the sheet to document.body — never trapped inside a sticky ancestor', () => {
        const { container } = render(<OversightOverlay {...baseProps()} />);

        const sheet = screen.getByTestId('waiting-drawer-sheet');
        // The render root (a portal source) does not contain the sheet —
        // it was teleported to document.body instead.
        expect(container.contains(sheet)).toBe(false);
        expect(document.body.contains(sheet)).toBe(true);
    });

    it('shows the founder-approved waiting title and the real WaitingDrawer content', () => {
        render(<OversightOverlay {...baseProps()} />);

        expect(screen.getAllByText(oversightTranslations.mr.waitingLabel).length).toBeGreaterThan(0);
        expect(screen.getByTestId('waiting-drawer')).toBeInTheDocument();
    });

    it('the X button — the one back control, always top-right — calls onClose', () => {
        const onClose = vi.fn();
        render(<OversightOverlay {...baseProps({ onClose })} />);

        fireEvent.click(screen.getByTestId('waiting-drawer-close'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('tapping the backdrop also closes it, without double-firing from a sheet click', () => {
        const onClose = vi.fn();
        render(<OversightOverlay {...baseProps({ onClose })} />);

        // Clicking inside the sheet must NOT close it — stopPropagation.
        fireEvent.click(screen.getByTestId('waiting-drawer-sheet'));
        expect(onClose).not.toHaveBeenCalled();

        // The backdrop is the sheet's own parent portal root.
        const backdrop = screen.getByTestId('waiting-drawer-sheet').parentElement as HTMLElement;
        fireEvent.click(backdrop);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('seeing never approves — onAcknowledge is the only thing the Seen control can call', () => {
        // Enforced inside WaitingDrawer itself (spec §P-A); this proves the
        // overlay wrapper forwards the SAME callback, not a second path.
        const onAcknowledge = vi.fn();
        render(<OversightOverlay {...baseProps({ onAcknowledge })} />);

        fireEvent.click(screen.getByText(oversightTranslations.mr.seenControl));
        expect(onAcknowledge).toHaveBeenCalledTimes(1);
    });
});


describe('OversightOverlay — the freshness line (moved here 2026-08-29)', () => {
    // ITS ORIGIN. Founder decision 2026-08-26: *"one small chip inside the
    // oversight bar, last timing of the sync — not to mention sync as a word —
    // but in layman language it must show the app is up to date till, let's say,
    // 12am Tuesday. Please make sure you are connected to the internet or
    // something like that."*
    //
    // WHY IT IS HERE NOW. Founder ruling 2026-08-29 capped the strip at two
    // lines and sent this sentence *"inside"*. The properties below moved
    // verbatim from `CanonicalStrip.test.tsx` — the fact and its constraints did
    // not change, only which surface renders them.
    //
    // A FIXED CLOCK. The day label is relative (आज / काल), so without pinning
    // "now" these would pass or fail by the day the suite runs, and the failure
    // would look like a copy bug.
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-26T06:30:00Z')); // 12:00 IST, 26 Aug
    });

    afterEach(() => {
        vi.useRealTimers();
        cleanup();
    });

    it('renders the known form from a real lastSyncAt — never a literal time', () => {
        // 05:30Z = 11:00 IST the same IST day ⇒ "आज सकाळी 11:00". The instant is
        // the ONLY source of those digits; nothing here may synthesise a time.
        render(<OversightOverlay {...baseProps({ lastSyncAt: '2026-08-26T05:30:00Z' })} />);

        const line = screen.getByTestId('oversight-overlay-freshness');
        expect(line).toHaveTextContent('11:00');
        expect(line).toHaveTextContent(dataFreshnessTranslations.mr.dayToday);
        const clause = dataFreshnessTranslations.mr.showingWorkUpTo.split('{when}')[1].split('.')[0].trim();
        expect(line).toHaveTextContent(clause);
        expect(line.textContent).not.toContain('कधीपर्यन्तची');
    });

    it('English renders the same fact through the same table', () => {
        render(<OversightOverlay {...baseProps({ language: 'en', lastSyncAt: '2026-08-25T18:25:00Z' })} />);
        // 18:25Z on 25 Aug = 23:55 IST on 25 Aug — yesterday, by the calendar.
        expect(screen.getByTestId('oversight-overlay-freshness'))
            .toHaveTextContent('Showing work up to Yesterday 11:55 PM');
    });

    it('says so when there is no last-sync instant — never falls back to now', () => {
        render(<OversightOverlay {...baseProps({ lastSyncAt: null })} />);
        const line = screen.getByTestId('oversight-overlay-freshness');
        expect(line).toHaveTextContent(dataFreshnessTranslations.mr.showingWorkUpToUnknown);
        // The pinned clock is 12:00 IST — if the component ever fell back to
        // "now", this is the digit pair that would appear.
        expect(line.textContent).not.toContain('12:00');
    });

    it('an unparseable cursor lands on the same honest unknown, not on today', () => {
        render(<OversightOverlay {...baseProps({ lastSyncAt: 'not-a-date' })} />);
        const line = screen.getByTestId('oversight-overlay-freshness');
        expect(line).toHaveTextContent(dataFreshnessTranslations.mr.showingWorkUpToUnknown);
        expect(line.textContent).not.toContain(dataFreshnessTranslations.mr.dayToday);
    });

    it('never contains the word "sync", in either language or either form', () => {
        for (const props of [
            baseProps({ lastSyncAt: '2026-08-26T05:30:00Z' }),
            baseProps({ lastSyncAt: null }),
            baseProps({ language: 'en', lastSyncAt: '2026-08-26T05:30:00Z' }),
            baseProps({ language: 'en', lastSyncAt: null }),
        ]) {
            const { unmount } = render(<OversightOverlay {...props} />);
            const text = screen.getByTestId('oversight-overlay-freshness').textContent ?? '';
            expect(text.toLowerCase()).not.toContain('sync');
            unmount();
        }
    });

    it('uses the locked Devanagari body font for the Marathi sentence', () => {
        render(<OversightOverlay {...baseProps({ lastSyncAt: '2026-08-26T05:30:00Z' })} />);
        const line = screen.getByTestId('oversight-overlay-freshness');
        expect(line.getAttribute('style')).toContain('Noto Sans Devanagari');
    });
});
