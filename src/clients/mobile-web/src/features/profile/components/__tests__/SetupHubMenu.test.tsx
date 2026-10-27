// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Task 7 (labour-v2-release-1) — the Profile menu's "कामगार व्यवस्थापन ·
 * Labour" row carried "हजेरी · मजुरी · उचल" as its subtitle, live and
 * reachable from every account with a farm (not behind any SHOW_* flag).
 * "हजेरी" (attendance) is one of three headline words the row uses to
 * describe the feature it opens, but there is no attendance capture
 * anywhere in the Labour feature — the hub hero is a doorway to the generic
 * log mic, not a recorder. P4/P5.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SetupHubMenu } from '../SetupHubMenu';

const baseProps = () => ({
    farmerName: 'Test Farmer',
    verified: false,
    items: [],
    onSelect: vi.fn(),
    logout: vi.fn(),
});

describe('SetupHubMenu — Labour row honesty (Task 7)', () => {
    afterEach(() => cleanup());

    // Task 7 removed हजेरी from this row when no attendance capture existed. Attendance
    // now exists (हजेरी घ्या, Labour V2) and the founder named the section
    // `कामगार व हजेरी` (2026-10-16), so the founder-chosen NAME is the one allowed
    // हजेरी; the subtitle still makes no attendance claim.
    it('does not claim हजेरी (attendance) in the Labour row subtitle', () => {
        render(<SetupHubMenu {...baseProps()} onOpenLabour={vi.fn()} />);
        expect(screen.getByText('कामगार व हजेरी')).toBeInTheDocument();
        expect(screen.getAllByText(/हजेरी/)).toHaveLength(1);
        expect(screen.getByText('मजुरी')).toBeInTheDocument();
    });

    it('keeps मजुरी in the subtitle — the surgical deletion removes only हजेरी', () => {
        render(<SetupHubMenu {...baseProps()} onOpenLabour={vi.fn()} />);
        expect(screen.getByText(/मजुरी/)).toBeInTheDocument();
    });

    // Task 7b (labour-v2-release-1) — उचल (advance) does not exist as a
    // system: no table, no write path, no engine (GetLabourDataHandler.cs:205
    // hardcodes `advance = 0m` server-side). This subtitle promised it as a
    // headline capability of Labour Management, standing beside the हजेरी
    // claim Task 7 already removed from this same string.
    it('does not claim उचल (advance) in the Labour row subtitle', () => {
        render(<SetupHubMenu {...baseProps()} onOpenLabour={vi.fn()} />);
        expect(screen.getByText('कामगार व हजेरी')).toBeInTheDocument();
        expect(screen.queryByText(/उचल/)).toBeNull();
    });
});

// Journey fix D10 - Marathi `X पैकी Y` means "Y out of X": the TOTAL comes
// before पैकी. The card said `{done} पैकी {total}`, i.e. "4 पैकी 5 पूर्ण" for
// 4 done of 5, which reads as "5 of 4 complete".
describe('SetupHubMenu - the setup progress count reads the right way round', () => {
    afterEach(() => cleanup());

    // spec: plr-d10 I7 (WP-5) — the redesigned hub reads in plain Marathi only (founder T1–T3: no
    // English doubling), so the English "4 of 5 complete" line is gone; the word-order guard stays.
    it('4 of 5 done: Marathi says 5 पैकी 4 पूर्ण, never 4 पैकी 5 पूर्ण; no English doubling', () => {
        render(<SetupHubMenu {...baseProps()} setupProgress={{ done: 4, total: 5, percent: 80, nextLabel: 'x' }} />);
        expect(screen.getByText(/5 पैकी 4 पूर्ण/)).toBeInTheDocument();
        expect(screen.queryByText(/4 पैकी 5/)).toBeNull();
        expect(screen.queryByText(/complete/i)).toBeNull();
    });
});

// spec: plr-d7-m1-multiuser-2026-10-26 (step 2, MU-11 / P-4) — "माणसं → माझी टीम" is its own row,
// the farm's permanent code sits on the top card, and a waiting request is counted on the row.
describe('SetupHubMenu — माझी टीम and the farm code (PLR-D7 M1 step 2)', () => {
    afterEach(() => cleanup());

    it('shows the farm code on the top card only when the server sent one', () => {
        const { rerender } = render(<SetupHubMenu {...baseProps()} farmCode="K7M2QP" />);
        expect(screen.getByTestId('hub-farm-code')).toHaveTextContent('शेत कोड');
        expect(screen.getByTestId('hub-farm-code')).toHaveTextContent('K7M2QP');
        rerender(<SetupHubMenu {...baseProps()} farmCode={null} />);
        expect(screen.queryByTestId('hub-farm-code')).toBeNull();
    });

    it('the माझी टीम row opens the team page, and says how many people wait for an answer', () => {
        const onOpenTeam = vi.fn();
        const { rerender } = render(<SetupHubMenu {...baseProps()} onOpenTeam={onOpenTeam} />);
        const row = screen.getByTestId('hub-team');
        expect(row).toHaveTextContent('माझी टीम');
        expect(row).toHaveTextContent('कोण, कोणती भूमिका · नवीन व्यक्ती जोडा');
        row.click();
        expect(onOpenTeam).toHaveBeenCalledTimes(1);

        rerender(<SetupHubMenu {...baseProps()} onOpenTeam={onOpenTeam} teamRequestCount={2} />);
        expect(screen.getByTestId('hub-team')).toHaveTextContent('2 जण आत येऊ इच्छितात');
    });

    it('a मुकादम\'s row says he looks at his crew (no request count, no add line)', () => {
        render(<SetupHubMenu {...baseProps()} onOpenTeam={vi.fn()} teamViewOnly teamRequestCount={3} />);
        expect(screen.getByTestId('hub-team')).toHaveTextContent('माझ्या टोळीतले लोक');
        expect(screen.getByTestId('hub-team')).not.toHaveTextContent('आत येऊ');
    });

    it('no माझी टीम row without an owner-tier door (a worker\'s hub has none)', () => {
        render(<SetupHubMenu {...baseProps()} onOpenLabour={vi.fn()} />);
        expect(screen.queryByTestId('hub-team')).toBeNull();
    });
});
