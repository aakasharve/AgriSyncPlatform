// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * Pins the dev-only preview page's ONE job: prove the real
 * `CanonicalStrip` + `WaitingDrawer` + `buildOversightModel` derivation
 * actually works end to end over the page's own seed fixtures — not that
 * the two components merely render with some props. No mocking: this suite
 * renders the real `OversightPreview`, the real oversight components, and
 * the real selector, exactly the way a founder loading
 * `?preview=oversight` in a browser would exercise them.
 */
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

import OversightPreview from '../OversightPreview';
import { resolveOversightString } from '../../../i18n/oversightTranslations';

afterEach(() => {
    cleanup();
});

describe('OversightPreview — the seeded canonical strip', () => {
    it('renders_the_real_farm_chip_and_a_nonzero_waiting_count_derived_from_seed_logs', () => {
        render(<OversightPreview />);

        expect(screen.getByTestId('canonical-strip-farm-chip')).toHaveTextContent('Arve Farm');
        expect(screen.getByTestId('canonical-strip-farm-chip')).toHaveTextContent('4');
        // 3 decisions (approval/dayNotClosed/failedSend) + 3 named people
        // (Rokade/Jadhav/Shinde) — computed by the real selector, not a
        // literal in this test.
        expect(screen.getByTestId('canonical-strip-waiting-count')).toHaveTextContent('6');
    });

    it('shows_the_preview_banner_so_a_screenshot_can_never_be_mistaken_for_real_farm_data', () => {
        render(<OversightPreview />);

        expect(screen.getByTestId('oversight-preview-banner')).toHaveTextContent(
            'PREVIEW — seeded data, not a real farm',
        );
    });
});

describe('OversightPreview — opening the drawer', () => {
    it('shows_the_delegated_decision_the_two_plain_decisions_all_named_people_and_the_unattributed_row', () => {
        render(<OversightPreview />);
        fireEvent.click(screen.getByTestId('canonical-strip-waiting-button'));

        expect(screen.getByTestId('waiting-drawer-sheet')).toBeInTheDocument();

        // The delegated approval decision renders as a plain, non-interactive
        // row (per WaitingDrawer's own contract) and names its holder.
        const approvalRow = screen.getByTestId('waiting-drawer-decision-approval');
        expect(approvalRow.tagName).toBe('DIV');
        expect(approvalRow).toHaveTextContent('Jadhav');

        expect(screen.getByTestId('waiting-drawer-decision-dayNotClosed')).toBeInTheDocument();
        expect(screen.getByTestId('waiting-drawer-decision-failedSend')).toHaveTextContent('1');

        expect(screen.getByTestId('waiting-drawer-person-row-op-rokade')).toHaveTextContent('Rokade');
        expect(screen.getByTestId('waiting-drawer-person-row-op-jadhav')).toHaveTextContent('Jadhav');
        expect(screen.getByTestId('waiting-drawer-person-row-op-shinde')).toHaveTextContent('Shinde');
        expect(screen.getByTestId('waiting-drawer-unattributed-row')).toBeInTheDocument();

        // Rokade has one seed log dated BEFORE the initial checkpoint — it
        // must not inflate his record count.
        expect(screen.getByTestId('waiting-drawer-person-row-op-rokade')).toHaveTextContent('2');

        expect(screen.getByTestId('waiting-drawer-tally-people')).toHaveTextContent('3');
        expect(screen.getByTestId('waiting-drawer-tally-records')).toHaveTextContent('6');
        expect(screen.getByTestId('waiting-drawer-tally-plots')).toHaveTextContent('4');
    });
});

describe('OversightPreview — pressing Seen', () => {
    it('collapses_the_briefing_to_empty_while_every_decision_row_stays_put', async () => {
        render(<OversightPreview />);
        fireEvent.click(screen.getByTestId('canonical-strip-waiting-button'));

        fireEvent.click(screen.getByTestId('waiting-drawer-seen-button'));

        await waitFor(() => {
            expect(screen.getByTestId('waiting-drawer-tally-people')).toHaveTextContent('0');
        });
        expect(screen.getByTestId('waiting-drawer-tally-records')).toHaveTextContent('0');
        expect(screen.getByTestId('waiting-drawer-tally-plots')).toHaveTextContent('0');
        expect(screen.queryByTestId('waiting-drawer-person-row-op-rokade')).not.toBeInTheDocument();
        expect(screen.queryByTestId('waiting-drawer-unattributed-row')).not.toBeInTheDocument();

        // Seeing is never approving: all three decisions are still there,
        // untouched by the acknowledgement.
        expect(screen.getByTestId('waiting-drawer-decision-approval')).toBeInTheDocument();
        expect(screen.getByTestId('waiting-drawer-decision-dayNotClosed')).toBeInTheDocument();
        expect(screen.getByTestId('waiting-drawer-decision-failedSend')).toBeInTheDocument();

        // Closing and re-reading the strip: waitingCount now reflects only
        // the 3 surviving decisions, not the old 6.
        fireEvent.click(screen.getByTestId('waiting-drawer-close'));
        expect(screen.getByTestId('canonical-strip-waiting-count')).toHaveTextContent('3');
    });

    it('reset_returns_the_page_to_the_original_unseen_state', async () => {
        render(<OversightPreview />);
        fireEvent.click(screen.getByTestId('canonical-strip-waiting-button'));
        fireEvent.click(screen.getByTestId('waiting-drawer-seen-button'));
        await waitFor(() => {
            expect(screen.getByTestId('waiting-drawer-tally-people')).toHaveTextContent('0');
        });

        fireEvent.click(screen.getByTestId('oversight-preview-reset'));

        expect(screen.getByTestId('waiting-drawer-tally-people')).toHaveTextContent('3');
        expect(screen.getByTestId('canonical-strip-waiting-count')).toHaveTextContent('6');
    });
});

describe('OversightPreview — language toggle', () => {
    it('switches_every_resolved_string_between_marathi_and_english_without_inventing_new_copy', () => {
        render(<OversightPreview />);
        fireEvent.click(screen.getByTestId('canonical-strip-waiting-button'));

        // Default language is 'mr' — the waiting-drawer sheet header reads
        // the Marathi resolution of the SAME translation key AppHeader.tsx
        // uses.
        expect(screen.getByTestId('waiting-drawer-sheet')).toHaveTextContent(
            resolveOversightString('mr', 'waitingLabel'),
        );

        fireEvent.click(screen.getByTestId('oversight-preview-lang-en'));

        expect(screen.getByTestId('waiting-drawer-sheet')).toHaveTextContent(
            resolveOversightString('en', 'waitingLabel'),
        );
    });
});
