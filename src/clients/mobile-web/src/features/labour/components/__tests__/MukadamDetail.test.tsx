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

    it('still shows the real balance figures (काम झालं / दिलं / बाकी)', () => {
        render(<MukadamDetail {...baseProps()} personId="rokade" />);
        expect(screen.getByText('काम झालं')).toBeInTheDocument();
        expect(screen.getByText('दिलं')).toBeInTheDocument();
    });
});
