// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (part 03, A4) — the moment the real answer is back:
 *   - the lit parts are exactly the parts THIS recording's records tell (the ring's own rule); never one the answer did not contain (P5);
 *   - the marked parts are exactly what the result model calls missing for the day (`day.missing`); अडथळा is never marked;
 *   - once per recording, over the result screen (on the back stack while it shows), and a tap or the time it needs takes it away.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const flags = vi.hoisted(() => ({ voiceFlowV2: true as boolean | undefined }));
vi.mock('../../../../../app/featureFlags', async (orig) => {
    const real = await orig<typeof import('../../../../../app/featureFlags')>();
    return { ...real, FEATURE_FLAGS: new Proxy(real.FEATURE_FLAGS, { get: (t, k) => (k === 'voiceFlowV2' ? flags.voiceFlowV2 : Reflect.get(t, k)) }) };
});
vi.mock('../../../../../i18n/LanguageContext', () => {
    const ctx = () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k });
    return { useOptionalLanguage: ctx, useLanguage: ctx };
});

import type { DailyLog } from '../../../../../types';
import type { CategoryId } from '../../shramsathi/understandingRing/categories';
import { __resetBackStackForTests, openOverlayCount } from '../../../../../core/navigation/backStack';
import { buildDayView, ringNodesForDay, type WhoDeps } from '../../voiceResult/resultModel';
import { REVEAL_MS, RingRevealHost, forgetRingReveals, missedRingParts, toldRingParts } from '../RingReveal';

const DATE = '2026-11-28';
const log = (id: string, over: Record<string, unknown>): DailyLog => ({
    id, date: DATE, dayOutcome: 'WORK_RECORDED',
    context: { selection: [{ cropId: 'c1', cropName: 'Grapes', selectedPlotIds: ['plot-1'], selectedPlotNames: ['प्लॉट १'] }] },
    cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [],
    meta: { createdAtISO: `${DATE}T10:00:00.000Z`, createdByOperatorId: 'me', farmId: 'farm-1' },
    ...over,
}) as unknown as DailyLog;

/** This recording: four workers and two hours of drip water. */
const NOW = log('L-NOW', {
    fullTranscript: 'चार गडी होते, दोन तास ठिबकने पाणी दिलं',
    labour: [{ id: 'lab', count: 4, sourceText: 'चार गडी होते' }],
    irrigation: [{ id: 'irr', durationHours: 2, method: 'Drip', sourceText: 'दोन तास ठिबकने पाणी दिलं' }],
});
/** Earlier today, same plot: a spray (told then, not now). */
const EARLIER = log('L-EARLY', {
    fullTranscript: 'सकाळी फवारणी केली',
    inputs: [{ id: 'in', method: 'Spray', sourceText: 'फवारणी केली', mix: [{ id: 'm', productName: 'कॉन्फिडॉर', dose: 250, unit: 'ml' }] }],
    meta: { createdAtISO: `${DATE}T04:00:00.000Z`, createdByOperatorId: 'me', farmId: 'farm-1' },
});
const deps: WhoDeps = { youIds: new Set(['me']), nameOf: () => undefined, unknownLabel: '-', language: 'mr', nativeDigits: true };

const stateOf = (id: string) => screen.getByTestId(`sathi-ring-${id}`).getAttribute('data-state');
const idsIn = (state: string): CategoryId[] => [...screen.getByTestId('sathi-ring').querySelectorAll(`[data-state="${state}"]`)]
    .map(n => n.getAttribute('data-testid')!.replace('sathi-ring-', '') as CategoryId);
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => { vi.useFakeTimers(); forgetRingReveals(); __resetBackStackForTests(); flags.voiceFlowV2 = true; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('A4 — the ring lights what the answer told', () => {
    it('the lit parts are exactly the parts this recording tells (the ring\'s own rule)', () => {
        render(<RingRevealHost recordingKey="k1" logs={[NOW]} history={[NOW, EARLIER]} />);
        const told = ringNodesForDay([NOW], DATE).filter(n => n.state === 'told').map(n => n.id);
        expect(new Set(idsIn('told'))).toEqual(new Set(told));
        expect(new Set(idsIn('told'))).toEqual(new Set(['labour', 'water']));
        expect(screen.getByTestId('sathi-ring')).toHaveAttribute('data-mode', 'reveal');
        expect(screen.getByTestId('sathi-ring')).toHaveAttribute('data-lit', '2');
        expect(screen.getByTestId('ring-reveal-line')).toHaveTextContent('श्रम साथीने समजून घेतलं ✓');
    });

    it('a part told earlier today but not in this recording is NOT lit (and not marked missing)', () => {
        render(<RingRevealHost recordingKey="k1" logs={[NOW]} history={[NOW, EARLIER]} />);
        expect(stateOf('inputs')).toBe('quiet');
    });

    it('the marked parts are exactly what the result model calls missing for the day; अडथळा is never marked', () => {
        render(<RingRevealHost recordingKey="k1" logs={[NOW]} history={[NOW, EARLIER]} />);
        const missing = buildDayView([NOW], [NOW, EARLIER], deps).missing;
        expect(missing.length).toBeGreaterThan(0);
        expect(new Set(idsIn('missed'))).toEqual(missedRingParts(missing));
        expect(idsIn('missed')).not.toContain('blockers');
        expect(idsIn('missed')).not.toContain('labour');
        expect(idsIn('missed')).not.toContain('water');
        expect(screen.getByTestId('ring-reveal-missed')).toHaveTextContent('लाल भाग अजून सांगितले नाहीत');
    });

    it('the helpers: nothing told from no records, and only ring parts are ever marked', () => {
        expect(toldRingParts([]).size).toBe(0);
        expect([...missedRingParts(['crop', 'labour', 'irrigation', 'inputs', 'expense', 'machinery', 'observation', 'planned'])])
            .toEqual(['work', 'labour', 'inputs', 'water', 'machinery', 'expenses', 'observations', 'reminders']);
    });

    it('it shows over the result screen while on the back stack, and goes by itself after its time', () => {
        render(<RingRevealHost recordingKey="k1" logs={[NOW]} history={[NOW, EARLIER]} />);
        expect(screen.getByTestId('ring-reveal')).toBeInTheDocument();
        expect(openOverlayCount()).toBe(1);
        const lit = idsIn('told').length + idsIn('missed').length;
        advance(REVEAL_MS + lit * 160 - 10);
        expect(screen.getByTestId('ring-reveal')).toBeInTheDocument();
        advance(20);
        expect(screen.queryByTestId('ring-reveal')).not.toBeInTheDocument();
        expect(openOverlayCount()).toBe(0);
    });

    it('a tap goes to the result at once; the same recording never reveals twice', () => {
        const view = render(<RingRevealHost recordingKey="k1" logs={[NOW]} history={[NOW, EARLIER]} />);
        fireEvent.click(screen.getByTestId('ring-reveal'));
        expect(screen.queryByTestId('ring-reveal')).not.toBeInTheDocument();
        view.unmount();
        render(<RingRevealHost recordingKey="k1" logs={[NOW]} history={[NOW, EARLIER]} />);
        expect(screen.queryByTestId('ring-reveal')).not.toBeInTheDocument();
        cleanup();
        render(<RingRevealHost recordingKey="k2" logs={[NOW]} history={[NOW, EARLIER]} />);
        expect(screen.getByTestId('ring-reveal')).toBeInTheDocument();
    });

    it('no saved record (a failure, nothing written): nothing is revealed', () => {
        render(<RingRevealHost recordingKey="k-none" logs={[]} history={[]} />);
        expect(screen.queryByTestId('ring-reveal')).not.toBeInTheDocument();
        expect(openOverlayCount()).toBe(0);
    });
});
