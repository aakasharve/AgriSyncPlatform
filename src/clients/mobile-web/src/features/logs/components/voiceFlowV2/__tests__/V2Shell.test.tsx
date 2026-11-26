// @vitest-environment jsdom
/** spec: voice-flow-v2-2026-11-23 — the design's full-screen frame: slim bar, a real count of days, no streak. */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { V2Shell, daysRecordedThisMonth, daysLabel } from '../V2Shell';

afterEach(cleanup);

describe('V2Shell', () => {
    it('counts distinct days of this month only (never a streak)', () => {
        const today = new Date(2026, 10, 26);
        expect(daysRecordedThisMonth([{ date: '2026-11-01' }, { date: '2026-11-01' }, { date: '2026-11-20' }, { date: '2026-10-31' }] as never, today)).toBe(2);
        expect(daysLabel(18, 'mr')).toBe('या महिन्यात १८ दिवस');
        expect(daysLabel(18, 'en')).toBe('18 days this month');
    });
    it('draws the place, the day count, the back arrow and the footer', () => {
        const back = vi.fn();
        render(<V2Shell place="द्राक्ष · Grapes A" days={3} onBack={back} footer={<span>foot</span>}><p>body</p></V2Shell>);
        expect(screen.getByTestId('v2-place')).toHaveTextContent('द्राक्ष · Grapes A');
        expect(screen.getByTestId('v2-days')).toHaveTextContent('या महिन्यात ३ दिवस');
        fireEvent.click(screen.getByTestId('v2-back'));
        expect(back).toHaveBeenCalled();
        expect(screen.getByTestId('v2-footer')).toHaveTextContent('foot');
    });
    it('no days recorded: no count pill', () => {
        render(<V2Shell place="x" days={0}><p>b</p></V2Shell>);
        expect(screen.queryByTestId('v2-days')).toBeNull();
    });
});
