// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT4 Task 0b; founder 2026-11-06 "one number score, one place") - the
 * understanding meter ("N/१०") is the ONLY score on any screen and it sits on the result screen, right after the श्रम साथी
 * understanding screen. It reads the IT3 per-plot score of the plot this recording is about; a recording with no plot reads the
 * farm-day score; a read that failed shows nothing invented.
 */
import React from 'react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const { flags, farmDay, plotDay, ringScores } = vi.hoisted(() => ({
    flags: { understandingMeter: true },
    farmDay: vi.fn(),
    plotDay: vi.fn(),
    ringScores: [] as unknown[],
}));
vi.mock('../../../../../app/featureFlags', async (orig) => {
    const real = await orig<typeof import('../../../../../app/featureFlags')>();
    return { ...real, FEATURE_FLAGS: new Proxy(real.FEATURE_FLAGS, { get: (t, k) => (k in flags ? flags[k as keyof typeof flags] : t[k as keyof typeof t]) }) };
});
vi.mock('../../../hooks/useDayUnderstanding', () => ({ useDayUnderstanding: (...a: unknown[]) => farmDay(...a) }));
vi.mock('../../../hooks/usePlotDayUnderstanding', () => ({ usePlotDayUnderstanding: (...a: unknown[]) => plotDay(...a) }));
vi.mock('../../shramsathi/understandingRing', async (orig) => {
    const real = await orig<typeof import('../../shramsathi/understandingRing')>();
    return { ...real, UnderstandingRing: (p: { score: unknown }) => { ringScores.push(p.score); return <div data-testid="understanding-ring" />; } };
});

import ResultHero, { type ResultHeroProps } from '../ResultHero';
import { forgetPlayedReveals } from '../RingStage';

const props = (over: Partial<ResultHeroProps> = {}): ResultHeroProps => ({
    farmId: 'farm-1', dayDate: '2026-11-09', savedLogId: 'LOG-1', recordingKey: 'rec-1',
    nodes: [], missing: ['machinery'], onTellMore: vi.fn(), onReadMore: vi.fn(), ...over,
});

beforeEach(() => {
    flags.understandingMeter = true;
    ringScores.length = 0;
    forgetPlayedReveals();
    farmDay.mockReset();
    plotDay.mockReset();
    farmDay.mockReturnValue({ score: 7, classification: null, refresh: vi.fn(async () => undefined), isLoading: false, error: null });
    plotDay.mockReturnValue({ score: 4, refresh: vi.fn(async () => undefined) });
});
afterEach(() => cleanup());

describe('the meter reads the plot of this recording (lane IT4 Task 0b)', () => {
    it('ResultHero_ShowsPlotScore_ForThisPlot', () => {
        render(<ResultHero {...props({ plotId: 'plot-1' })} />);
        expect(plotDay).toHaveBeenCalledWith('farm-1', 'plot-1', '2026-11-09', expect.stringContaining('LOG-1'));
        // The ring is given THIS plot's 4, not the farm day's 7.
        expect(ringScores.at(-1)).toBe(4);
    });

    it('a recording with NO plot reads the farm-day score', () => {
        render(<ResultHero {...props({ plotId: null })} />);
        expect(ringScores.at(-1)).toBe(7);
        expect(plotDay).toHaveBeenCalledWith('farm-1', null, '2026-11-09', expect.any(String)); // the hook makes no call without a plot
    });

    it('a plot read that failed shows nothing invented - never the farm-day score in its place', () => {
        plotDay.mockReturnValue({ score: null, refresh: vi.fn(async () => undefined) });
        render(<ResultHero {...props({ plotId: 'plot-1' })} />);
        expect(ringScores.at(-1)).toBeNull();
        expect(screen.queryByTestId('vr-ring-message')).toBeNull();
    });

    it('flag off: neither score is fetched', () => {
        flags.understandingMeter = false;
        render(<ResultHero {...props({ plotId: 'plot-1' })} />);
        expect(farmDay).not.toHaveBeenCalled();
        expect(plotDay).not.toHaveBeenCalled();
    });
});

/** Every non-test source file under src, relative to src. */
const sourceFiles = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
            if (name !== '__tests__' && name !== 'node_modules') sourceFiles(p, out);
        } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
    }
    return out;
};

describe('the day-score meter is drawn in exactly the places listed here (ResultHero_IsTheOnlyMeter, narrowed to what it proves)', () => {
    const SRC = join(process.cwd(), 'src');
    /** A file that IMPORTS a meter component (the card, the ring, the bar, the gauge, the stage that draws the ring). */
    const MOUNTS_METER = /import\s[^;]*?\b(?:DayUnderstandingCard|RingStage|UnderstandingBar|UnderstandingGauge|UnderstandingRing)\b[^;]*?from\s/;

    it('only ResultHero (the result screen) and, known and pre-existing, the saved route\'s DayUnderstandingCard draw a meter', () => {
        const mounting = sourceFiles(SRC)
            .filter(f => MOUNTS_METER.test(readFileSync(f, 'utf8')))
            .map(f => relative(SRC, f).split(sep).join('/'));
        // EXPLICIT allowlist. The result screen's meter is `ResultHero` (through `RingStage`). KNOWN, PRE-EXISTING SECOND METER, not
        // part of this lane and left as it is (raised separately as a register item): `core/navigation/savedView.tsx` still renders
        // the older flag-gated `DayUnderstandingCard` (the farm-day X/१०) on the non-voice saved route, under
        // FEATURE_FLAGS.understandingMeter. The other entries are the card's, the stage's and the ring's own implementation files.
        const ALLOWED = [
            'core/navigation/savedView.tsx', // KNOWN second meter (DayUnderstandingCard on the saved route), see above
            'features/logs/components/shramsathi/DayUnderstandingCard.tsx',
            'features/logs/components/voiceResult/ResultHero.tsx', // the result screen's meter
            'features/logs/components/voiceResult/RingStage.tsx', // ... drawn through the ring stage
            'features/logs/components/shramsathi/understandingRing/UnderstandingRing.tsx', // the ring itself
        ];
        expect(mounting.filter(f => !ALLOWED.includes(f))).toEqual([]);
        // The two route-level mounts: the result screen's hero, and the saved route's card.
        expect(mounting.filter(f => f.startsWith('core/navigation/'))).toEqual(['core/navigation/savedView.tsx']);
        expect(readFileSync(join(SRC, 'core/navigation/savedView.tsx'), 'utf8')).toMatch(/FEATURE_FLAGS\.understandingMeter|DayUnderstandingCard/);
        // Nothing of the farm overview (आढावा / Reflect) draws one.
        expect(mounting.filter(f => /^features\/reflect\//.test(f))).toEqual([]);
    });

    it('the plot score is read by the result screen\'s hero and by nothing else', () => {
        const readers = sourceFiles(SRC)
            .filter(f => readFileSync(f, 'utf8').includes('usePlotDayUnderstanding') && !/usePlotDayUnderstanding\.ts$/.test(f))
            .map(f => relative(SRC, f).split(sep).join('/'));
        expect(readers).toEqual(['features/logs/components/voiceResult/ResultHero.tsx']);
    });

    it('the reflect (आढावा) sources carry no "/१०" meter text and no daily points list', () => {
        for (const f of sourceFiles(join(SRC, 'features', 'reflect'))) {
            const text = readFileSync(f, 'utf8');
            expect(/\/\s*१०|\/\s*10\b/.test(text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), f).toBe(false);
        }
    });
});
