// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 5, amendment H7) — the mic card's ring is armed ONLY by a plot tap made on this
 * screen, only with the flag on, never through the हजेरी door or while one part is said again.
 */
import '@testing-library/jest-dom/vitest';
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CropProfile } from '../../../../../types';
import type { LogScope } from '../../../../../domain/types/log.types';

const flags = vi.hoisted(() => ({ voiceFlowV2: true as boolean | undefined }));
vi.mock('../../../../../app/featureFlags', async (importOriginal) => {
    const real = await importOriginal<typeof import('../../../../../app/featureFlags')>();
    return { ...real, FEATURE_FLAGS: new Proxy(real.FEATURE_FLAGS, { get: (t, k) => (k === 'voiceFlowV2' ? flags.voiceFlowV2 : Reflect.get(t, k)) }) };
});

import { LogEntryFlow, type LogEntryFlowProps, type RecorderHooks } from '../LogEntryFlow';
import { __resetBackStackForTests } from '../../../../../core/navigation/backStack';

const crop = (id: string, name: string, plots: string[]) =>
    ({ id, name, iconName: 'Grape', color: 'emerald', plots: plots.map((n, i) => ({ id: `${id}-${i + 1}`, name: n })) }) as unknown as CropProfile;
const CROPS = [crop('grape', 'द्राक्ष', ['सोनाका', 'थॉम्पसन'])];
const EMPTY: LogScope = { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' };
const CHOSEN: LogScope = { selectedCropIds: ['grape'], selectedPlotIds: ['grape-1'], mode: 'single', applyPolicy: 'broadcast' };

const seen: RecorderHooks[] = [];
const lastArm = () => seen[seen.length - 1]?.armSeq;

const Harness: React.FC<Partial<LogEntryFlowProps> & { initialScope?: LogScope }> = ({ initialScope = EMPTY, ...over }) => {
    const [scope, setScope] = useState<LogScope>(initialScope);
    return (
        <LogEntryFlow
            crops={CROPS} logScope={scope} setLogScope={setScope} onChooseVoice={vi.fn()}
            labourIntent={false} onBackToLabour={vi.fn()} onClearLabourIntent={vi.fn()}
            recordingSegment={null} onCancelSegment={vi.fn()}
            renderRecorder={(hooks) => { seen.push(hooks); return <div data-testid="fake-recorder" />; }}
            {...over}
        />
    );
};

afterEach(() => { cleanup(); __resetBackStackForTests(); seen.length = 0; flags.voiceFlowV2 = true; });

describe('LogEntryFlow — the mic ring is armed by a plot tap', () => {
    it('0 when arriving with a plot already chosen; 1 after one plot tap; 2 after a second', () => {
        render(<Harness initialScope={CHOSEN} />);
        expect(lastArm()).toBe(0);
        fireEvent.click(screen.getByTestId('flow-plot-grape-2'));
        expect(lastArm()).toBe(1);
        fireEvent.click(screen.getByTestId('flow-plot-grape-1'));
        expect(lastArm()).toBe(2);
    });

    it('a fresh crop then plot choice arms it once', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('home-tell'));
        fireEvent.click(screen.getByTestId('flow-crop-grape'));
        fireEvent.click(screen.getByTestId('flow-plot-grape-1'));
        expect(lastArm()).toBe(1);
    });

    it('flag off: no armSeq at all (today\'s recorder hooks)', () => {
        flags.voiceFlowV2 = undefined;
        render(<Harness initialScope={CHOSEN} />);
        fireEvent.click(screen.getByTestId('flow-plot-grape-2'));
        expect(seen.length).toBeGreaterThan(0);
        expect(seen.every(h => !('armSeq' in h))).toBe(true);
    });

    it('the हजेरी door never arms it', () => {
        render(<Harness initialScope={CHOSEN} labourIntent />);
        fireEvent.click(screen.getByTestId('flow-plot-grape-2'));
        expect(seen.every(h => !('armSeq' in h))).toBe(true);
    });

    it('one part said again (segment) passes no armSeq', () => {
        render(<Harness initialScope={CHOSEN} recordingSegment={'labour' as LogEntryFlowProps['recordingSegment']} />);
        expect(seen.length).toBeGreaterThan(0);
        expect(seen.every(h => !('armSeq' in h))).toBe(true);
    });
});
