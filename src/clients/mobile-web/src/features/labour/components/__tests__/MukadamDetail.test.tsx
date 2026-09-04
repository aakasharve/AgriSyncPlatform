// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MukadamDetail tests — Decision 4b (2026-07-19, screen honesty): the same
 * "उचल द्या" / "सेटल" fake-toast issue as `PersonDetail`'s worker page exists
 * here too (`onAdvance`/`onSettle` both fire a "— नमुना" placeholder, no
 * server write) — hidden the same way, via `BalanceCard`'s `showActions`.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import MukadamDetail from '../MukadamDetail';
import { LABOUR_MOCK } from '../../labourMock';

const baseProps = () => ({
    data: LABOUR_MOCK,
    onOpenPerson: vi.fn(),
    onOpenMukadam: vi.fn(),
    onAdvance: vi.fn(),
    onSettle: vi.fn(),
});

describe('MukadamDetail — screen honesty (Decision 4b)', () => {
    afterEach(() => cleanup());

    it('hides the उचल द्या / सेटल actions — both fire a placeholder toast only, no real write', () => {
        render(<MukadamDetail {...baseProps()} personId="rokade" />);
        expect(screen.queryByText('उचल द्या')).toBeNull();
        expect(screen.queryByText('सेटल')).toBeNull();
    });

    it('still shows the real balance figures (कामाचे पैसे / दिलं / बाकी)', () => {
        render(<MukadamDetail {...baseProps()} personId="rokade" />);
        expect(screen.getByText('कामाचे पैसे')).toBeInTheDocument();
        expect(screen.getByText('दिलं')).toBeInTheDocument();
    });

    // Task 7b (labour-v2-release-1) — उचल (advance) does not exist as a
    // system: no table, no write path, no engine
    // (GetLabourDataHandler.cs:205 hardcodes `advance = 0m` server-side).
    // This line asserted "तुम्ही ₹0 उचल दिली" (you gave ₹0 advance) as a
    // narrative fact about a real farmer action — false not because the
    // figure is wrong, but because no such tracked fact exists at all.
    it('does not claim a specific उचल amount was given — no advance system exists', () => {
        render(<MukadamDetail {...baseProps()} personId="rokade" />);
        expect(screen.queryByText(/उचल दिली/)).toBeNull();
    });
});

/*
 * TASK 22 (spec: 2026-08-28-labour-v2-release-1) — "his team (0)" is a
 * confident zero for a field the server never populates. `GetLabourDataHandler.cs`
 * hardcodes `MemberIds: null` for every worker today, so on a real farm
 * `m.memberIds` is always unknown, not genuinely empty. Elsewhere in this
 * same codebase (`LabourHub.tsx`'s people list, `LabourUiKit.tsx`'s
 * `PersonRow`) this is already handled correctly: `teamCount` is only shown
 * `!= null`. `MukadamDetail`'s own header broke that rule by coalescing
 * `m.memberIds ?? []` BEFORE the count, turning an unknown into "(0)" — a
 * real मुकादम with actual team members would still read "his team (0)"
 * until Stage 5/whatever populates this field ships. The fix withholds the
 * parenthetical count entirely when the value is unknown, and keeps showing
 * it when it is genuinely known (मॉक: रोकडे has 3 real members).
 */
describe('MukadamDetail — "his team" count is honest about unknown vs. genuinely zero (Task 22)', () => {
    afterEach(() => cleanup());

    it('shows the real count when memberIds is a known list (रोकडे: 3 real members)', () => {
        render(<MukadamDetail {...baseProps()} personId="rokade" />);
        expect(screen.getByText(/याच्यासोबत आलेली माणसं \(3\)/)).toBeInTheDocument();
    });

    it('does not claim "his team (0)" when memberIds is unknown — the server always sends null, this is not a genuine zero', () => {
        const dataWithUnknownTeam = {
            ...LABOUR_MOCK,
            people: {
                ...LABOUR_MOCK.people,
                rokade: { ...LABOUR_MOCK.people.rokade, memberIds: undefined },
            },
        };
        render(<MukadamDetail {...baseProps()} data={dataWithUnknownTeam} personId="rokade" />);
        expect(screen.queryByText(/याच्यासोबत आलेली माणसं \(0\)/)).toBeNull();
        expect(screen.getByText(/याच्यासोबत आलेली माणसं/)).toBeInTheDocument();
    });
});
