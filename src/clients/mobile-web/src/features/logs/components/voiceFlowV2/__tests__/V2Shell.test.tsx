// @vitest-environment jsdom
/** spec: voice-flow-v2-2026-11-23 — the design's full-screen frame: slim bar, a real count of days, no streak. */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const { flags } = vi.hoisted(() => ({ flags: { voiceFlowV2: true as boolean | undefined } }));
vi.mock('../../../../../app/featureFlags', async (orig) => {
    const real = await orig<typeof import('../../../../../app/featureFlags')>();
    return { ...real, FEATURE_FLAGS: new Proxy(real.FEATURE_FLAGS, { get: (t, k) => (k in flags ? flags[k as keyof typeof flags] : t[k as keyof typeof t]) }) };
});

import { AboveV2Shell, V2Shell, daysRecordedThisMonth, daysLabel } from '../V2Shell';

afterEach(() => { cleanup(); flags.voiceFlowV2 = true; document.querySelectorAll('[data-app-shell]').forEach(n => n.remove()); });

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

    it('is drawn into the app\'s own frame when there is one (the app\'s layer order: above its header, below its toast)', () => {
        const app = document.createElement('div');
        app.setAttribute('data-app-shell', '');
        document.body.appendChild(app);
        render(<V2Shell place="x" days={1}><p>b</p></V2Shell>);
        expect(screen.getByTestId('v2-shell').parentElement).toBe(app);
        expect(screen.getByTestId('v2-shell').className).toContain('z-[51]');
    });
    it('no app frame: drawn into the page body', () => {
        render(<V2Shell place="x" days={1}><p>b</p></V2Shell>);
        expect(screen.getByTestId('v2-shell').parentElement).toBe(document.body);
    });
    it('the app\'s toast is lifted one layer above the frame with the flag on; flag off it is the toast alone', () => {
        render(<AboveV2Shell><span data-testid="toast">t</span></AboveV2Shell>);
        expect(screen.getByTestId('above-v2-shell').className).toContain('z-[52]');
        cleanup();
        flags.voiceFlowV2 = undefined;
        render(<AboveV2Shell><span data-testid="toast">t</span></AboveV2Shell>);
        expect(screen.queryByTestId('above-v2-shell')).toBeNull();
        expect(screen.getByTestId('toast')).toBeTruthy();
    });
});
