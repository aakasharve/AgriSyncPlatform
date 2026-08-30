// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop (founder rulings 2026-08-30)
 *
 * The nameboard replaced six elements in row 1 with one, and three of the
 * properties it has to hold were each found by the founder looking at the built
 * screen rather than by a test:
 *
 *   1. the farmer's name must not appear beside the farm's name
 *   2. a one-farm account must not get a switcher it cannot use
 *   3. the shield must not be green-on-green
 *
 * jsdom performs no layout, so the auto-fit itself is not assertable here — it
 * was measured in a real browser at 320/360/412/420 across four name lengths.
 * What IS assertable is every property above, and they are the ones that broke.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

import FarmNameBoard from '../FarmNameBoard';

afterEach(() => cleanup());

function props(overrides: Partial<React.ComponentProps<typeof FarmNameBoard>> = {}) {
    return {
        farmName: 'Arve Farm',
        onOpenFarmSwitcher: vi.fn(),
        ...overrides,
    };
}

describe('FarmNameBoard — the farm name is the identity', () => {
    it('renders the farm name it is given, verbatim', () => {
        render(<FarmNameBoard {...props({ farmName: 'पुरुषोत्तम शेत' })} />);
        expect(screen.getByTestId('farm-nameboard-name')).toHaveTextContent('पुरुषोत्तम शेत');
    });

    it('sets the Devanagari heading face for a Marathi name and DM Sans otherwise', () => {
        // Root CLAUDE.md font rule: Marathi headings are Noto Serif Devanagari,
        // English/brand/numerals are DM Sans. A farm name is a heading here.
        const { rerender } = render(<FarmNameBoard {...props({ farmName: 'पुरुषोत्तम शेत' })} />);
        expect(screen.getByTestId('farm-nameboard-name').getAttribute('style'))
            .toContain('Noto Serif Devanagari');

        rerender(<FarmNameBoard {...props({ farmName: 'Arve Farm' })} />);
        expect(screen.getByTestId('farm-nameboard-name').getAttribute('style'))
            .toContain('DM Sans');
    });

    it('names the tool in the subtitle without claiming a credential for the farm', () => {
        // An earlier draft read "Shram Safal Registered Farm". There is no
        // farm-registration feature in this codebase, so that sentence would
        // have asserted a status the product does not issue — permanently, on
        // every screen. "Managed by" is true of the records.
        render(<FarmNameBoard {...props()} />);
        const subtitle = screen.getByTestId('farm-nameboard-subtitle');
        expect(subtitle).toHaveTextContent('Managed by Shram Safal');
        expect(subtitle.textContent?.toLowerCase()).not.toContain('registered');
    });

    it('omits the subtitle when asked, without disturbing the name', () => {
        render(<FarmNameBoard {...props({ showSubtitle: false })} />);
        expect(screen.queryByTestId('farm-nameboard-subtitle')).not.toBeInTheDocument();
        expect(screen.getByTestId('farm-nameboard-name')).toHaveTextContent('Arve Farm');
    });
});

describe('FarmNameBoard — a control only when there is somewhere to go', () => {
    it('a single-farm account gets identity, not a switcher', () => {
        // Task 12 established this for the farm chip. The nameboard made it easy
        // to lose: the founder removed the chevron and made the WHOLE board the
        // target, so without the gate every farmer would tap into a sheet
        // listing one farm.
        const onOpenFarmSwitcher = vi.fn();
        render(<FarmNameBoard {...props({ canSwitch: false, onOpenFarmSwitcher })} />);

        const board = screen.getByTestId('farm-nameboard');
        expect(board.tagName).not.toBe('BUTTON');
        expect(board).toHaveAttribute('data-can-switch', 'false');
        // Not merely un-styled as a control — genuinely not one, so a screen
        // reader never announces something that does nothing when activated.
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
        fireEvent.click(board);
        expect(onOpenFarmSwitcher).not.toHaveBeenCalled();
    });

    it('a multi-farm account gets a real button that opens the switcher', () => {
        const onOpenFarmSwitcher = vi.fn();
        render(<FarmNameBoard {...props({ canSwitch: true, onOpenFarmSwitcher })} />);

        const board = screen.getByTestId('farm-nameboard');
        expect(board.tagName).toBe('BUTTON');
        expect(board).toHaveAttribute('data-can-switch', 'true');
        fireEvent.click(board);
        expect(onOpenFarmSwitcher).toHaveBeenCalledTimes(1);
    });

    it('a disabled board does not open the switcher', () => {
        const onOpenFarmSwitcher = vi.fn();
        render(<FarmNameBoard {...props({ canSwitch: true, disabled: true, onOpenFarmSwitcher })} />);

        fireEvent.click(screen.getByTestId('farm-nameboard'));
        expect(onOpenFarmSwitcher).not.toHaveBeenCalled();
    });
});

describe('FarmNameBoard — the shield has to be legible', () => {
    it('renders the real brand mark on a light ground, not bare on the green', () => {
        // FOUNDER, on the built screen: the logo "is not visible properly".
        // `logo-mark.webp` is a GREEN shield with a dark green outline, and the
        // board is a dark green gradient — the outline dissolved into it. The
        // cream disc is what makes the mark readable, so it is load-bearing and
        // a future cleanup must not mistake it for ornament.
        const { container } = render(<FarmNameBoard {...props()} />);

        const img = container.querySelector('img[src="/brand/logo-mark.webp"]');
        expect(img).not.toBeNull();

        const disc = img!.parentElement!;
        expect(disc.className).toContain('rounded-full');
        // A light ground, not the board's own dark green. jsdom normalises the
        // hex to rgb(), so the cream token is asserted in that form.
        expect(disc.getAttribute('style')).toContain('rgb(251, 245, 236)');
    });

    it('keeps the mark and the name in one group so a short name cannot drift', () => {
        // FOUNDER: a short name "feels disconnected" from the mark. The cause was
        // a flex-1 name slot that centred the text inside the leftover space, so
        // the shorter the name the further it sat from the shield. The row now
        // centres mark+name as a GROUP, which is what keeps the gap fixed.
        const { container } = render(<FarmNameBoard {...props({ farmName: 'A' })} />);

        const img = container.querySelector('img[src="/brand/logo-mark.webp"]');
        const row = img!.closest('span.flex.items-center.justify-center');
        expect(row, 'mark and name must share a justify-center row').not.toBeNull();
        // The name column must not stretch, or the group re-opens the gap.
        const nameCol = screen.getByTestId('farm-nameboard-name').closest('span.flex-col');
        expect(nameCol!.className).not.toContain('flex-1');
    });
});
