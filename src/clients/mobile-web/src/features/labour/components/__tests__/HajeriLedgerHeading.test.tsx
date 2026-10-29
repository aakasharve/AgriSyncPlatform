// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I20 / N4, founder D-16) — "The heading must
 * describe the dates actually displayed. Never show 'सर्व दिवस' for a filtered period." The open
 * वही used to fall back to "सर्व दिवस" for EVERY window (the server's `weekLabel` is a bare ISO date,
 * which is never a readable range), so a week or a month read as "all days".
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import HajeriLedger from '../HajeriLedger';
import { EMPTY_LABOUR_DATA } from '../../labourMock';
import type { LabourData } from '../../labour.types';

const withWindow = (windowFrom: string, windowTo: string): LabourData => ({
    ...EMPTY_LABOUR_DATA,
    view: 'owner',
    dashboard: { ...EMPTY_LABOUR_DATA.dashboard, weekLabel: windowFrom, windowFrom, windowTo },
    ledger: { ...EMPTY_LABOUR_DATA.ledger, weekLabel: windowFrom, days: [] },
});

describe('HajeriLedger — the heading names the dates shown (N4)', () => {
    afterEach(() => cleanup());

    it('a week window names its exact range, never "सर्व दिवस"', () => {
        render(<HajeriLedger data={withWindow('2026-10-26', '2026-10-29')} onToast={() => undefined} embedded />);
        expect(screen.getByTestId('ledger-heading')).toHaveTextContent('२६–२९ ऑक्टो');
        expect(screen.queryByText('सर्व दिवस')).toBeNull();
    });

    it('a month window names its first and last day', () => {
        render(<HajeriLedger data={withWindow('2026-09-01', '2026-09-30')} onToast={() => undefined} />);
        expect(screen.getByTestId('ledger-heading')).toHaveTextContent('१–३० सप्टें · हजेरी वही');
    });

    it('only the unbounded आजपर्यंत window, which is every day on record, says सर्व दिवस', () => {
        render(<HajeriLedger data={withWindow('', '')} onToast={() => undefined} embedded />);
        expect(screen.getByTestId('ledger-heading')).toHaveTextContent('सर्व दिवस');
    });
});
