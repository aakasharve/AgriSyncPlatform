// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 1, task 1a (CTO ruling 2). The first-record card's
 * "बोलायला सुरुवात करा" opens the log tab's OWN entry flow, the "झालेले काम सांगा" path:
 *   - a farm with no crop: the whole farm is chosen before the tab mounts, so the flow opens on "संपूर्ण शेत" with the mic
 *     (a one-tile question would be friction, P9);
 *   - a farm with crops: a one-shot request makes the tab open on the crop question, exactly where "झालेले काम सांगा" lands;
 *     read once, so the next visit opens on the work home as always.
 */
import '@testing-library/jest-dom/vitest';
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CropProfile } from '../../../../../types';
import type { LogScope } from '../../../../../domain/types/log.types';
import { LogEntryFlow, type LogEntryFlowProps, type RecorderHooks } from '../LogEntryFlow';
import { clearEntryOpening, peekEntryOpening, requestEntryOpening } from '../entryOpening';
import { __resetBackStackForTests } from '../../../../../core/navigation/backStack';

const crop = (id: string, name: string, iconName: string, plots: string[]) =>
    ({ id, name, iconName, color: 'emerald', plots: plots.map((n, i) => ({ id: `${id}-${i + 1}`, name: n })) }) as unknown as CropProfile;
const CROPS = [crop('grape', 'द्राक्ष', 'Grape', ['सोनाका', 'थॉम्पसन'])];
const EMPTY: LogScope = { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' };
const WHOLE_FARM: LogScope = { selectedCropIds: ['FARM_GLOBAL'], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' };

const FakeRecorder: React.FC<{ hooks: RecorderHooks }> = () => <div data-testid="fake-recorder" />;

const Harness: React.FC<Partial<LogEntryFlowProps> & { initialScope?: LogScope; cropList?: CropProfile[] }> = ({ initialScope = EMPTY, cropList = CROPS, ...over }) => {
    const [scope, setScope] = useState<LogScope>(initialScope);
    return (
        <LogEntryFlow
            crops={cropList} logScope={scope} setLogScope={setScope} onChooseVoice={vi.fn()}
            labourIntent={false} onBackToLabour={vi.fn()} onClearLabourIntent={vi.fn()}
            recordingSegment={null} onCancelSegment={vi.fn()}
            renderRecorder={hooks => <FakeRecorder hooks={hooks} />}
            {...over}
        />
    );
};

afterEach(() => { cleanup(); clearEntryOpening(); __resetBackStackForTests(); });

describe('R1-g 1a — the card\'s "बोलायला सुरुवात करा" lands in the log tab\'s own entry flow', () => {
    it('no crop on the farm: the whole farm, chosen before the tab mounts, opens straight on "संपूर्ण शेत" and the mic', () => {
        render(<Harness cropList={[]} initialScope={WHOLE_FARM} />);
        expect(screen.getByTestId('log-entry-flow')).toHaveAttribute('data-step', 'plot');
        expect(screen.getByTestId('flow-crop-chip')).toHaveTextContent('संपूर्ण शेत');
        expect(screen.getByTestId('fake-recorder')).toBeInTheDocument();
        expect(screen.queryByTestId('flow-step-crop')).toBeNull();
        expect(screen.queryByTestId('home-tell')).toBeNull();
    });

    it('crops on the farm: the one-shot request opens the crop question, the "झालेले काम सांगा" step, and is read once', () => {
        requestEntryOpening();
        render(<Harness />);
        expect(screen.getByTestId('log-entry-flow')).toHaveAttribute('data-step', 'crop');
        expect(screen.getByTestId('flow-step-crop')).toBeInTheDocument();
        expect(screen.getByTestId('flow-sathi-question')).toHaveTextContent('कोणत्या पिकावर काम झालं ?');
        expect(screen.getByTestId('flow-crop-grape')).toBeInTheDocument();
        expect(screen.queryByTestId('fake-recorder')).toBeNull();
        expect(screen.queryByTestId('home-tell')).toBeNull();
        expect(peekEntryOpening()).toBeNull();
        // the crop step then works exactly as from the work home's door: its plots, then the mic
        fireEvent.click(screen.getByTestId('flow-crop-grape'));
        fireEvent.click(screen.getByTestId('flow-plot-grape-1'));
        expect(screen.getByTestId('fake-recorder')).toBeInTheDocument();
        // and its back goes to the work home, as from "झालेले काम सांगा"
        cleanup();
        requestEntryOpening();
        render(<Harness />);
        fireEvent.click(screen.getByTestId('entry-back-home'));
        expect(screen.getByTestId('log-entry-flow')).toHaveAttribute('data-step', 'home');
    });

    it('no request: the tab opens on the work home exactly as before, and the ONE mic\'s own flow never reads the request', () => {
        render(<Harness />);
        expect(screen.getByTestId('log-entry-flow')).toHaveAttribute('data-step', 'home');
        expect(screen.getByTestId('home-tell')).toBeInTheDocument();
        cleanup();
        requestEntryOpening();
        render(<Harness startAt="entry" onExit={vi.fn()} />);
        expect(screen.getByTestId('log-entry-flow')).toHaveAttribute('data-step', 'crop');
        // the ONE mic's flow (startAt) leaves the log tab's request for the log tab
        expect(peekEntryOpening()).toBe('crop');
    });

    it('a tab tap (home requested) wins over a request left behind', () => {
        requestEntryOpening();
        render(<Harness homeRequested onHomeRequestHandled={vi.fn()} />);
        expect(screen.getByTestId('log-entry-flow')).toHaveAttribute('data-step', 'home');
        expect(peekEntryOpening()).toBeNull();
    });
});
