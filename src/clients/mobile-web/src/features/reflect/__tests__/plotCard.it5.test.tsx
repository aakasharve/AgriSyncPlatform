// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT5, Task 2; founder 2026-11-06) - the plot cards of पूर्ण शेतीचा आढावा
 * say WHO told the day (a real name, the phone holder's own too, never "तुम्ही") and carry ONE "अजून सांगा" line with a mic -
 * words only: no meter, no bar, no number, no "/१०", no "समज". Offline or unlisted: nothing is made up.
 *
 * The whole page is rendered on real-shaped records; only the infrastructure edges are mocked (farm context, the ledger read, the
 * clip player, attachment counts, telemetry, and the server read of the plot rows - which here ALWAYS carries a score, to prove the
 * page never shows it).
 */
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';

vi.mock('../../../core/session/FarmContext', () => ({ useFarmContext: () => ({ currentFarmId: 'farm-1' }) }));
vi.mock('../../../shared/hooks/useUiPref', async () => {
    const { useState } = await import('react');
    return { useUiPref: <T,>(_key: string, fallback: T) => { const [v, set] = useState<T>(fallback); return [v, set, true] as const; } };
});
vi.mock('../../../services/harvestService', () => ({ getHarvestSessions: () => [], getOtherIncomeEntries: () => [] }));
vi.mock('../../attachments', () => ({ AttachmentList: () => null, useAttachmentRetry: () => ({ retryUpload: vi.fn() }) }));
vi.mock('../overview/useLogAttachmentCount', () => ({ useLogAttachmentCount: () => 0 }));
vi.mock('../../../core/telemetry/eventEmitters', () => ({ emitClosureSummaryViewed: vi.fn(), emitNextActionCreated: vi.fn() }));
vi.mock('../../logs/components/FarmWideTodayPanel', () => ({ default: () => null }));
vi.mock('../../finance/components/MoneyLensDrawer', () => ({ MoneyLensDrawer: () => null }));
vi.mock('../overview/useMoneyLedger', () => ({ useMoneyLedger: () => ({ entries: [], gaps: [], complete: true }) }));
vi.mock('../day/useDayListen', () => ({
    useDayListen: () => ({ kindOf: () => 'none', clipOf: () => undefined, playing: () => false, progress: 0, lengthOf: () => null, toggle: () => undefined, stop: () => undefined, farmOf: () => null }),
}));
vi.mock('../../../infrastructure/voice/logOriginalVoice', () => ({ fetchLogOriginalVoice: vi.fn() }));
vi.mock('../../../infrastructure/sync/PayloadValidator', () => ({ validatePayload: () => ({ ok: true }) }));
// The companion flag is ON for these tests; the flag-OFF test (the production default) turns it off for itself only.
const flags = vi.hoisted(() => ({ current: null as null | { understandingMeter: boolean } }));
vi.mock('../../../app/featureFlags', async (importActual) => {
    const actual = await importActual<typeof import('../../../app/featureFlags')>();
    const FEATURE_FLAGS = { ...actual.FEATURE_FLAGS, understandingMeter: true };
    flags.current = FEATURE_FLAGS;
    return { ...actual, FEATURE_FLAGS };
});
const getPlotDayUnderstanding = vi.hoisted(() => vi.fn());
vi.mock('../../../infrastructure/api/AgriSyncClient', () => ({ agriSyncClient: { getPlotDayUnderstanding: (...args: unknown[]) => getPlotDayUnderstanding(...args) } }));
const lang = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock('../../../i18n/LanguageContext', async (importActual) => ({
    ...(await importActual<typeof import('../../../i18n/LanguageContext')>()),
    useOptionalLanguage: () => (lang.value ? { language: lang.value } : null),
}));

import ReflectPage from '../ReflectPage';
import { speakersOf, withNextHint, buildPlotDayCard } from '../overview/plotDayModel';
import { usePlotUnderstanding } from '../overview/usePlotUnderstanding';
import { plotRefsInScope, selectAll, toViewScope } from '../overview/reflectSelection';
import { CROPS, TODAY, TODAY_KEY, log } from './reflectFixtures';

const HINT_MR = 'पिकात काय दिसलं ते';
const HINT_EN = 'What you saw in the crop';
/** The server's rows ALWAYS carry a score here - the page must never show it. */
const ROWS = [
    { plotId: 'g1', score0to10: 7, understood: [{ mr: 'छाटणी', en: 'Pruning' }], nextHint: { mr: HINT_MR, en: HINT_EN } },
    { plotId: 'g2', score0to10: 4, understood: [], nextHint: { mr: 'पाणी किती दिलं ते', en: 'How much water' } },
];

const history = [
    log({ id: 'g1-me', plotIds: ['g1'], cropActivities: [{ id: 'a', title: 'छाटणी' }], meta: { createdAtISO: '2026-10-25T03:40:00.000Z', createdByOperatorId: 'me' } }),
    log({ id: 'g1-sunil', plotIds: ['g1'], irrigation: [{ id: 'i', method: 'drip', source: 'Well' }], meta: { createdAtISO: '2026-10-25T04:40:00.000Z', createdByOperatorId: 'op-sunil' } }),
];

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 25, 10, 0, 0));
    lang.value = undefined;
    getPlotDayUnderstanding.mockReset();
    getPlotDayUnderstanding.mockResolvedValue(ROWS);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const renderPage = (over: Partial<React.ComponentProps<typeof ReflectPage>> = {}) => {
    const props = {
        history, crops: CROPS, tasks: [], onUpdateTask: vi.fn(), navigate: vi.fn(), onOpenLog: vi.fn(), onSpeak: vi.fn(),
        sessionUserId: 'me', ownName: 'प्रकाश', farmRole: 'PrimaryOwner',
        operators: [{ id: 'op-sunil', name: 'सुनील' }] as React.ComponentProps<typeof ReflectPage>['operators'],
        ...over,
    };
    render(<ReflectPage {...props} />);
    return props;
};

describe('पूर्ण शेतीचा आढावा - the plot card (IT5 Task 2)', () => {
    it('NoNumberOrBar_OnReflect: the page carries no "/१०", no "समज", no bar and no number - even though the server sent a score', async () => {
        renderPage();
        await waitFor(() => expect(screen.getByTestId('plot-hint-grape:g1')).toBeInTheDocument()); // the server answered
        expect(getPlotDayUnderstanding).toHaveBeenCalledWith('farm-1', TODAY_KEY);
        const page = document.body.textContent ?? '';
        expect(page).not.toMatch(/\/\s*(१०|10)\b/);
        expect(page).not.toContain('समज');
        expect(page).not.toMatch(/\b7\s*\/|\b७\s*\//); // the score the server sent is nowhere
        expect(document.querySelector('[role="progressbar"], [role="meter"], progress, meter')).toBeNull();
        expect(document.querySelector('[data-testid*="meter" i], [data-testid*="score" i], [data-testid*="understanding" i]')).toBeNull();
        // the card's hint is words only
        expect(screen.getByTestId('plot-hint-grape:g1')).toHaveTextContent(`अजून सांगा: ${HINT_MR}`);
    });

    it('NoNumberOrBar_OnReflect (source): nothing the Reflect page renders - its own files and every feature/shared file they import, transitively - reads a score or draws the meter', () => {
        // vitest runs from the phone project's root (`src/clients/mobile-web`)
        const src = path.resolve(process.cwd(), 'src');
        const reflect = path.join(src, 'features', 'reflect');
        expect(fs.existsSync(reflect)).toBe(true);
        const isCode = (f: string) => /\.(ts|tsx)$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f);
        const resolveImport = (from: string, spec: string): string | null => {
            const base = path.resolve(path.dirname(from), spec);
            for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) if (fs.existsSync(candidate)) return candidate;
            return null;
        };
        const seen = new Set<string>();
        const walkDir = (dir: string) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.name === '__tests__') continue;
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walkDir(full); else if (isCode(full)) seen.add(full);
            }
        };
        walkDir(reflect);
        // follow relative imports into features/logs, shared, i18n, core and domain (what a card actually draws), not into infrastructure
        const queue = [...seen];
        while (queue.length) {
            const file = queue.pop()!;
            for (const m of fs.readFileSync(file, 'utf8').matchAll(/from\s+'(\.{1,2}\/[^']+)'/g)) {
                const target = resolveImport(file, m[1]);
                if (!target || seen.has(target) || !isCode(target) || target.includes(`${path.sep}infrastructure${path.sep}`)) continue;
                seen.add(target);
                queue.push(target);
            }
        }
        const files = [...seen];
        expect(files.length).toBeGreaterThan(40);
        expect(files.some(f => f.endsWith(path.join('understandingRing', 'index.ts')) || f.includes('understandingRing'))).toBe(true); // the icon module the card uses is in the scan
        // code only: a comment that names the meter ("never useDayUnderstanding") is not a use of it
        const codeOf = (f: string) => fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
        const offenders = files.filter(f => /score0to10|usePlotDayUnderstanding|useDayUnderstanding|DayUnderstandingCard|ResultHero/.test(codeOf(f)));
        expect(offenders.map(f => path.relative(src, f))).toEqual([]);
    });

    it('SpeakerNames_Shown_NeverTumhi: every speaker by a real name - the phone holder by his profile name - and never "तुम्ही"', async () => {
        renderPage();
        const who = screen.getByTestId('plot-who-grape:g1');
        expect(who).toHaveTextContent('सांगितलं:');
        expect(Array.from(who.querySelectorAll('[data-testid^="plot-who-name-"]')).map(e => e.textContent)).toEqual(['प्रकाश', 'सुनील']);
        expect(document.body.textContent).not.toContain('तुम्ही');
        // the day view of the same plot says the same names
        fireEvent.click(screen.getByTestId('plot-card-grape:g1'));
        expect(screen.getByTestId('rf-day').textContent).not.toContain('तुम्ही');
        fireEvent.click(screen.getByTestId('rf-time-g1-me'));
        expect(screen.getByTestId('rf-rec-g1-me-who')).toHaveTextContent('प्रकाश');
    });

    it('SpeakerNames_Shown_NeverTumhi: a holder with no name (blank, or the placeholder "Owner") reads "अज्ञात" - not "तुम्ही", not a guess', () => {
        for (const ownName of [undefined, '  ', 'Owner']) {
            cleanup();
            renderPage({ ownName });
            const names = Array.from(screen.getByTestId('plot-who-grape:g1').querySelectorAll('[data-testid^="plot-who-name-"]')).map(e => e.textContent);
            expect(names).toEqual(['अज्ञात', 'सुनील']);
            expect(document.body.textContent).not.toContain('तुम्ही');
        }
    });

    it('SpeakerNames_Shown_NeverTumhi (model): each speaker once, in the order told; a name the operator list holds wins', () => {
        const refs = plotRefsInScope(CROPS, toViewScope(CROPS, selectAll(CROPS)));
        const g1 = refs.find(r => r.plotId === 'g1')!;
        const who = { youIds: new Set(['me']), nameOf: (id: string) => ({ 'op-sunil': 'सुनील' } as Record<string, string>)[id], ownName: 'प्रकाश', unknownLabel: 'अज्ञात' };
        const twice = [...history, log({ id: 'g1-me2', plotIds: ['g1'], cropActivities: [{ id: 'b', title: 'फवारणी' }], meta: { createdAtISO: '2026-10-25T05:40:00.000Z', createdByOperatorId: 'me' } })];
        expect(buildPlotDayCard(g1, twice, { viewCrops: [], viewPlots: {} }, TODAY_KEY, TODAY, undefined, 'mr', who).speakers).toEqual(['प्रकाश', 'सुनील']);
        expect(speakersOf([], who)).toEqual([]);
        // no name source given: no names (never a guess)
        expect(buildPlotDayCard(g1, twice, { viewCrops: [], viewPlots: {} }, TODAY_KEY, TODAY).speakers).toEqual([]);
    });

    it('NoLogPlot_ShowsNothingSaidLine_NoHint: a plot with nothing told keeps "आज अजून काही सांगितलं नाही" and gets no names and no hint, even if the server listed one', async () => {
        renderPage();
        await waitFor(() => expect(screen.getByTestId('plot-hint-grape:g1')).toBeInTheDocument());
        expect(screen.getByTestId('plot-empty-grape:g2')).toHaveTextContent('आज अजून काही सांगितलं नाही');
        expect(screen.queryByTestId('plot-hint-grape:g2')).toBeNull();
        expect(screen.queryByTestId('plot-who-grape:g2')).toBeNull();
        expect(screen.getByTestId('plot-card-grape:g2')).not.toHaveTextContent('पाणी किती दिलं ते');
        // the model: the same rule
        const refs = plotRefsInScope(CROPS, toViewScope(CROPS, selectAll(CROPS)));
        const empty = buildPlotDayCard(refs.find(r => r.plotId === 'g2')!, history, { viewCrops: [], viewPlots: {} }, TODAY_KEY, TODAY);
        expect(withNextHint(empty, 'कुठलीही ओळ').nextHint).toBeUndefined();
    });

    it('HintHasSpeakMic: the "अजून सांगा" line has a "बोला" mic that asks THE ONE mic for THAT plot, and does not open the day', async () => {
        const props = renderPage();
        const mic = await screen.findByTestId('plot-hint-speak-grape:g1');
        expect(mic).toHaveTextContent('बोला');
        fireEvent.click(mic);
        expect(props.onSpeak).toHaveBeenCalledTimes(1);
        expect(props.onSpeak).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'addToDay', context: { place: { cropId: 'grape', plotId: 'g1' } } }));
        expect(screen.queryByTestId('rf-day')).toBeNull(); // the card did not also open
    });

    it('HintHasSpeakMic: with no speak door there is no line at all (never a mic that leads nowhere), and no call is made', async () => {
        renderPage({ onSpeak: undefined });
        await new Promise(r => setTimeout(r, 0));
        expect(screen.queryByTestId('plot-hint-grape:g1')).toBeNull();
        expect(getPlotDayUnderstanding).not.toHaveBeenCalled();
    });

    it('HintHasSpeakMic: a day other than today shows no line (a past day is told through "त्या दिवसाचं काम सांगा")', async () => {
        renderPage();
        await screen.findByTestId('plot-hint-grape:g1');
        fireEvent.click(screen.getByTestId('reflect-section-calendar-toggle')); // the calendar is folded on first use
        fireEvent.click(screen.getByTestId('cal-prev'));
        fireEvent.click(screen.getByTestId('cal-day-2026-10-21'));
        expect(screen.getByTestId('plot-card-grape:g1')).toBeInTheDocument(); // the cards follow the chosen day
        expect(screen.queryByTestId('plot-hint-grape:g1')).toBeNull();
    });

    it('English mode shows the English line only, with English labels', async () => {
        lang.value = 'en';
        renderPage();
        const line = await screen.findByTestId('plot-hint-grape:g1');
        expect(line).toHaveTextContent(`Tell more: ${HINT_EN}`);
        expect(line.textContent).not.toContain(HINT_MR);
        expect(screen.getByTestId('plot-hint-speak-grape:g1')).toHaveTextContent('Speak');
        expect(screen.getByTestId('plot-who-grape:g1')).toHaveTextContent('Told by:');
    });

    it('Offline_ShowsNothingInvented: a failed read shows no line, no number, no error - the names (from this phone) stay', async () => {
        getPlotDayUnderstanding.mockRejectedValue(new Error('offline'));
        renderPage();
        await waitFor(() => expect(getPlotDayUnderstanding).toHaveBeenCalled());
        await new Promise(r => setTimeout(r, 0));
        expect(screen.queryByTestId('plot-hint-grape:g1')).toBeNull();
        expect(screen.queryByTestId('plot-hint-speak-grape:g1')).toBeNull();
        expect(screen.getByTestId('plot-who-grape:g1')).toHaveTextContent('प्रकाश');
        const page = document.body.textContent ?? '';
        expect(page).not.toMatch(/\/\s*(१०|10)\b/);
        expect(page).not.toMatch(/नेट|offline|त्रुटी|error/i);
    });

    it('Offline_ShowsNothingInvented: a plot the server does not list, or one with no line to say, gets none', async () => {
        getPlotDayUnderstanding.mockResolvedValue([{ plotId: 'g1', score0to10: 9, understood: [], nextHint: null }]);
        renderPage();
        await waitFor(() => expect(getPlotDayUnderstanding).toHaveBeenCalled());
        await new Promise(r => setTimeout(r, 0));
        expect(screen.queryByTestId('plot-hint-grape:g1')).toBeNull();
        expect(screen.getByTestId('plot-card-grape:g1')).not.toHaveTextContent('अजून सांगा');
    });
});

describe('the companion flag OFF (the production default)', () => {
    it('Offline_ShowsNothingInvented (flag off): no call, no line, no mic - the names from this phone still show', async () => {
        flags.current!.understandingMeter = false;
        try {
            renderPage();
            await new Promise(r => setTimeout(r, 20));
            expect(getPlotDayUnderstanding).not.toHaveBeenCalled();
            expect(screen.queryByTestId('plot-hint-grape:g1')).toBeNull();
            expect(screen.queryByTestId('plot-hint-speak-grape:g1')).toBeNull();
            expect(screen.getByTestId('plot-who-grape:g1')).toHaveTextContent('प्रकाश');
        } finally {
            flags.current!.understandingMeter = true;
        }
    });

    it('the hook alone with the flag off: no call, and every plot reads null', async () => {
        flags.current!.understandingMeter = false;
        try {
            const { result } = renderHook(() => usePlotUnderstanding('farm-1', TODAY_KEY, true));
            await new Promise(r => setTimeout(r, 20));
            expect(getPlotDayUnderstanding).not.toHaveBeenCalled();
            expect(result.current.hintFor('g1', 'mr')).toBeNull();
        } finally {
            flags.current!.understandingMeter = true;
        }
    });
});

describe('usePlotUnderstanding - words only', () => {
    it('returns only the line lookup (no score, no understood list), keyed by plot, in the asked language; flag off or not today = no call', async () => {
        const { result } = renderHook(() => usePlotUnderstanding('farm-1', TODAY_KEY, true));
        await waitFor(() => expect(result.current.hintFor('g1', 'mr')).toBe(HINT_MR));
        expect(Object.keys(result.current)).toEqual(['hintFor']);
        expect(result.current.hintFor('G1', 'en')).toBe(HINT_EN); // plot ids are compared without case
        expect(result.current.hintFor('g9', 'mr')).toBeNull();
        expect(result.current.hintFor(null, 'mr')).toBeNull();

        getPlotDayUnderstanding.mockClear();
        renderHook(() => usePlotUnderstanding('farm-1', TODAY_KEY, false));
        renderHook(() => usePlotUnderstanding(null, TODAY_KEY, true));
        await new Promise(r => setTimeout(r, 0));
        expect(getPlotDayUnderstanding).not.toHaveBeenCalled();
    });
});
