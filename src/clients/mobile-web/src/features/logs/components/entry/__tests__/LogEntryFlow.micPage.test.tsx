// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (part 03, A1; the founder's final design, 28 Nov) — on the log tab's full-screen
 * flow the plot page and the mic page are two pages:
 *   - the plot page has the green bar once a place is chosen, never the mic; a plot tap never arms the countdown;
 *   - a tap on the bar, or one swipe up, opens the mic page, and THAT arms the countdown (once per opening);
 *   - "प्लॉट बदला" and Back return to the plot page with the choice kept;
 *   - a farm with ONE plot goes from the crop tap straight to the mic page; arriving with a place already chosen opens it unarmed;
 *   - outside the full-screen flow the mic stays under the plots, as before.
 */
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act as rtlAct, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CropProfile } from '../../../../../types';
import type { LogScope } from '../../../../../domain/types/log.types';

const flags = vi.hoisted(() => ({ voiceFlowV2: true as boolean | undefined }));
vi.mock('../../../../../app/featureFlags', async (importOriginal) => {
    const real = await importOriginal<typeof import('../../../../../app/featureFlags')>();
    return { ...real, FEATURE_FLAGS: new Proxy(real.FEATURE_FLAGS, { get: (t, k) => (k === 'voiceFlowV2' ? flags.voiceFlowV2 : Reflect.get(t, k)) }) };
});

import { LogEntryFlow, hasOnlyOnePlot, type LogEntryFlowProps, type RecorderHooks } from '../LogEntryFlow';
import { __resetBackStackForTests, dismissTopOverlay } from '../../../../../core/navigation/backStack';

const crop =(id: string, name: string, plots: string[]) =>
    ({ id, name, iconName: 'Grape', color: 'emerald', plots: plots.map((n, i) => ({ id: `${id}-${i + 1}`, name: n })) }) as unknown as CropProfile;
const TWO_PLOTS = [crop('grape', 'द्राक्ष', ['सोनाका', 'थॉम्पसन'])];
const ONE_PLOT = [crop('grape', 'द्राक्ष', ['सोनाका'])];
const TWO_CROPS_ONE_PLOT_EACH = [crop('grape', 'द्राक्ष', ['सोनाका']), crop('tomato', 'टोमॅटो', ['प्लॉट १'])];
const EMPTY: LogScope = { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' };
const CHOSEN: LogScope = { selectedCropIds: ['grape'], selectedPlotIds: ['grape-1'], mode: 'single', applyPolicy: 'broadcast' };

/** Every set of hooks the recorder was drawn with (the recorder is drawn only where the mic is). */
const seen: RecorderHooks[] = [];
const lastArm = () => seen[seen.length - 1]?.armSeq;

const Harness: React.FC<Partial<LogEntryFlowProps> & { initialScope?: LogScope }> = ({ initialScope = EMPTY, crops = TWO_PLOTS, ...over }) => {
    const [scope, setScope] = useState<LogScope>(initialScope);
    return (
        <LogEntryFlow
            crops={crops} logScope={scope} setLogScope={setScope} onChooseVoice={vi.fn()}
            labourIntent={false} onBackToLabour={vi.fn()} onClearLabourIntent={vi.fn()}
            recordingSegment={null} onCancelSegment={vi.fn()} fullScreen
            renderRecorder={(hooks) => {
                seen.push(hooks);
                return <button type="button" data-testid="fake-recorder" data-arm={hooks.armSeq ?? 'none'} onClick={() => hooks.onRecordingChange(true)}>rec</button>;
            }}
            {...over}
        />
    );
};

const step = () => screen.getByTestId('log-entry-flow').getAttribute('data-step');
/** A one-finger touch at `y` (the handler reads `touches[0].clientY`). */
const touch = (el: Element, type: 'touchstart' | 'touchmove' | 'touchend', y: number) => {
    const e = new Event(type, { bubbles: true });
    Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [{ clientY: y }] });
    rtlAct(() => { el.dispatchEvent(e); });
};
const toPlotStep = () => {
    fireEvent.click(screen.getByTestId('home-tell'));
    fireEvent.click(screen.getByTestId('flow-crop-grape'));
};

afterEach(() => { cleanup(); __resetBackStackForTests(); seen.length = 0; flags.voiceFlowV2 = true; });

describe('LogEntryFlow — the plot page and the mic page (A1)', () => {
    it('the plot page has the green bar, never the mic; a plot tap never arms; the bar opens the mic page armed once', () => {
        render(<Harness />);
        toPlotStep();
        expect(step()).toBe('plot');
        expect(screen.queryByTestId('flow-mic-bar')).not.toBeInTheDocument();
        fireEvent.click(screen.getByTestId('flow-plot-grape-1'));
        fireEvent.click(screen.getByTestId('flow-plot-grape-2'));
        const bar = screen.getByTestId('flow-mic-bar');
        expect(screen.getByTestId('flow-mic-bar-place')).toHaveTextContent('— निवडले');
        expect(bar).toHaveTextContent('वर सरका — बोलायला सुरुवात');
        expect(screen.getByTestId('voice-layer-bottom')).toContainElement(bar);
        expect(screen.queryByTestId('fake-recorder')).not.toBeInTheDocument();
        expect(seen).toHaveLength(0);

        fireEvent.click(bar);
        expect(step()).toBe('mic');
        expect(screen.getByTestId('voice-layer')).toHaveAttribute('data-step', 'mic');
        expect(screen.getByTestId('fake-recorder')).toHaveAttribute('data-arm', '1');
        expect(screen.getByTestId('flow-change-plot')).toHaveTextContent('प्लॉट बदला');
        expect(screen.queryByTestId('flow-mic-bar')).not.toBeInTheDocument();
    });

    it('"प्लॉट बदला" returns to the plot page with the plots kept; opening again arms again', () => {
        render(<Harness />);
        toPlotStep();
        fireEvent.click(screen.getByTestId('flow-plot-grape-2'));
        fireEvent.click(screen.getByTestId('flow-mic-bar'));
        expect(lastArm()).toBe(1);
        fireEvent.click(screen.getByTestId('flow-change-plot'));
        expect(step()).toBe('plot');
        expect(screen.queryByTestId('fake-recorder')).not.toBeInTheDocument();
        expect(screen.getByTestId('flow-plot-grape-2')).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByTestId('flow-mic-bar'));
        expect(step()).toBe('mic');
        expect(lastArm()).toBe(2);
    });

    it('the phone\'s Back on the mic page goes to the plot page, then to the crop question', () => {
        render(<Harness />);
        toPlotStep();
        fireEvent.click(screen.getByTestId('flow-plot-grape-1'));
        fireEvent.click(screen.getByTestId('flow-mic-bar'));
        rtlAct(() => { expect(dismissTopOverlay()).toBe(true); });
        expect(step()).toBe('plot');
        rtlAct(() => { expect(dismissTopOverlay()).toBe(true); });
        expect(step()).toBe('crop');
    });

    it('one swipe up on the plot page opens the mic page, armed; a short move does not', () => {
        render(<Harness />);
        toPlotStep();
        fireEvent.click(screen.getByTestId('flow-plot-grape-1'));
        const page = screen.getByTestId('log-entry-flow');
        touch(page, 'touchstart', 400);
        touch(page, 'touchmove', 380);
        touch(page, 'touchend', 380);
        expect(step()).toBe('plot');
        touch(page, 'touchstart', 400);
        touch(page, 'touchmove', 350);
        expect(step()).toBe('mic');
        expect(lastArm()).toBe(1);
    });

    it('no swipe opens it before a place is chosen', () => {
        render(<Harness />);
        toPlotStep();
        const page = screen.getByTestId('log-entry-flow');
        touch(page, 'touchstart', 400);
        touch(page, 'touchmove', 300);
        expect(step()).toBe('plot');
        expect(screen.queryByTestId('fake-recorder')).not.toBeInTheDocument();
    });

    it('while he speaks, "प्लॉट बदला" steps away and Back does nothing', () => {
        render(<Harness />);
        toPlotStep();
        fireEvent.click(screen.getByTestId('flow-plot-grape-1'));
        fireEvent.click(screen.getByTestId('flow-mic-bar'));
        fireEvent.click(screen.getByTestId('fake-recorder'));
        expect(screen.getByTestId('log-entry-flow')).toHaveAttribute('data-recording', 'yes');
        expect(screen.queryByTestId('flow-change-plot')).not.toBeInTheDocument();
        rtlAct(() => { expect(dismissTopOverlay()).toBe(false); });
        expect(step()).toBe('mic');
    });

    it('a farm with ONE plot: the crop tap goes straight to the mic page, armed', () => {
        expect(hasOnlyOnePlot(ONE_PLOT)).toBe(true);
        render(<Harness crops={ONE_PLOT} />);
        fireEvent.click(screen.getByTestId('home-tell'));
        fireEvent.click(screen.getByTestId('flow-crop-grape'));
        expect(step()).toBe('mic');
        expect(screen.getByTestId('fake-recorder')).toHaveAttribute('data-arm', '1');
        // "प्लॉट बदला" still reaches the plot page (its "+" and the way back to the crop question, e.g. for संपूर्ण शेत)
        fireEvent.click(screen.getByTestId('flow-change-plot'));
        expect(step()).toBe('plot');
        expect(screen.getByTestId('flow-mic-bar')).toBeInTheDocument();
    });

    it('two crops of one plot each is not a one-plot farm: the plot page shows, its plot already picked', () => {
        expect(hasOnlyOnePlot(TWO_CROPS_ONE_PLOT_EACH)).toBe(false);
        expect(hasOnlyOnePlot(TWO_PLOTS)).toBe(false);
        expect(hasOnlyOnePlot([])).toBe(false);
        render(<Harness crops={TWO_CROPS_ONE_PLOT_EACH} />);
        fireEvent.click(screen.getByTestId('home-tell'));
        fireEvent.click(screen.getByTestId('flow-crop-grape'));
        expect(step()).toBe('plot');
        expect(screen.getByTestId('flow-mic-bar')).toBeInTheDocument();
        expect(seen).toHaveLength(0);
    });

    it('arriving with a place already chosen (back from the result, an error): the mic page, unarmed', () => {
        render(<Harness initialScope={CHOSEN} />);
        expect(step()).toBe('mic');
        expect(screen.getByTestId('fake-recorder')).toHaveAttribute('data-arm', '0');
    });

    it('outside the full-screen flow the mic stays under the plots, armed by a plot tap as before', () => {
        render(<Harness fullScreen={false} />);
        toPlotStep();
        fireEvent.click(screen.getByTestId('flow-plot-grape-1'));
        expect(step()).toBe('plot');
        expect(screen.queryByTestId('flow-mic-bar')).not.toBeInTheDocument();
        expect(screen.getByTestId('fake-recorder')).toHaveAttribute('data-arm', '1');
    });

    it('flag off: no two pages, no countdown arming', () => {
        flags.voiceFlowV2 = undefined;
        render(<Harness initialScope={CHOSEN} />);
        expect(step()).toBe('plot');
        expect(screen.getByTestId('fake-recorder')).toHaveAttribute('data-arm', 'none');
    });
});
