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
import { describe, it, expect, vi, afterEach } from 'vitest';

import type { Language } from '../../../../i18n/language';
import { oversightTranslations } from '../../../../i18n/oversightTranslations';
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
