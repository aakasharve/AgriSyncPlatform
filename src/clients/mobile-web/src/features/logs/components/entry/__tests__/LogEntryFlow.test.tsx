// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I12) — the आजची कामे tab on real data:
 * work home (one or two doors by role) -> crop -> that crop's plots -> mic; one-step back; the tab
 * tap returns home fresh; no dead "श्रम साथीशी बोला". Lane E1: no hand-filled form step any more. Lane MIC-1: the ONE
 * mic can open this flow on the crop question (`startAt="entry"`), with its band above the mic and its own exit.
 */
import '@testing-library/jest-dom/vitest';
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CropProfile } from '../../../../../types';
import type { LogScope } from '../../../../../domain/types/log.types';
import { LogEntryFlow, type LogEntryFlowProps, type RecorderHooks } from '../LogEntryFlow';
import { mayOpenAttendanceFromHome, isWorkerRole } from '../../../../labour/homeAttendanceDoor';
import { dismissTopOverlay, __resetBackStackForTests } from '../../../../../core/navigation/backStack';

const crop = (id: string, name: string, iconName: string, plots: string[]) =>
    ({ id, name, iconName, color: 'emerald', plots: plots.map((n, i) => ({ id: `${id}-${i + 1}`, name: n })) }) as unknown as CropProfile;
const CROPS = [crop('cane', 'ऊस', 'Sugarcane', ['ऊस १', 'ऊस २']), crop('grape', 'द्राक्ष', 'Grape', ['सोनाका', 'थॉम्पसन'])];
const EMPTY: LogScope = { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' };

/** Stands in for the real recorder: it reports recording on/off, like the real one. */
const FakeRecorder: React.FC<{ hooks: RecorderHooks }> = ({ hooks }) => (
    <div data-testid="fake-recorder">
        <button type="button" data-testid="fake-start" onClick={() => hooks.onRecordingChange(true)}>start</button>
        <button type="button" data-testid="fake-stop" onClick={() => hooks.onRecordingChange(false)}>stop</button>
    </div>
);

type HarnessProps = Partial<LogEntryFlowProps> & { initialScope?: LogScope; role?: string | null; cachedGrant?: boolean };
const Harness: React.FC<HarnessProps> = ({ initialScope = EMPTY, role = 'PrimaryOwner', cachedGrant, ...over }) => {
    const [scope, setScope] = useState<LogScope>(initialScope);
    return (
        <>
            <LogEntryFlow
                crops={CROPS} logScope={scope} setLogScope={setScope} onChooseVoice={vi.fn()}
                labourIntent={false} onBackToLabour={vi.fn()} onClearLabourIntent={vi.fn()}
                recordingSegment={null} onCancelSegment={vi.fn()}
                onOpenAttendance={mayOpenAttendanceFromHome(role, cachedGrant) ? vi.fn() : undefined}
                cost={isWorkerRole(role) ? undefined : { today: 1200, yesterday: 0, soFar: 45000, scopeLabel: 'संपूर्ण शेत' }}
                renderRecorder={hooks => <FakeRecorder hooks={hooks} />}
                {...over}
            />
            <output data-testid="scope">{JSON.stringify(scope)}</output>
        </>
    );
};
const scopeNow = (): LogScope => JSON.parse(screen.getByTestId('scope').textContent || '{}');

afterEach(() => { cleanup(); __resetBackStackForTests(); });

describe('work home — the tab opens on the doors (H08, H10)', () => {
    it('owner: two big doors, "झालेले काम सांगा" and "आजची हजेरी", and no plan door the server cannot back', () => {
        const onOpenAttendance = vi.fn();
        render(<Harness role="PrimaryOwner" onOpenAttendance={onOpenAttendance} />);
        expect(screen.getByTestId('home-title')).toHaveTextContent('काय करायचं आहे?');
        expect(screen.getByTestId('home-tell')).toHaveTextContent('झालेले काम सांगा');
        expect(screen.getByTestId('home-attendance')).toHaveTextContent('आजची हजेरी');
        expect(screen.getByTestId('home-attendance')).toHaveTextContent('हजेरी घ्या आणि हजेरी वही बघा');
        // only these two are drawn: the plan door waits on a server model (P5), not on a door limit
        expect(screen.getAllByRole('button')).toHaveLength(2);
        expect(document.body.textContent).not.toContain('कामांची जबाबदारी सोपवा');
        expect(document.body.textContent).not.toContain('कामांचे नियोजन करा');
        fireEvent.click(screen.getByTestId('home-attendance'));
        expect(onOpenAttendance).toHaveBeenCalledTimes(1);
    });

    it('worker: ONE door only — no हजेरी door, and no money', () => {
        render(<Harness role="Worker" />);
        expect(screen.getByTestId('home-tell')).toBeInTheDocument();
        expect(screen.queryByTestId('home-attendance')).toBeNull();
        expect(screen.getAllByRole('button')).toHaveLength(1);
        expect(screen.queryByTestId('running-cost-card')).toBeNull();
    });

    it('मुकादम: the हजेरी door only with the owner\'s labour grant (the server\'s cached answer)', () => {
        render(<Harness role="Mukadam" />);
        expect(screen.queryByTestId('home-attendance')).toBeNull();
        cleanup();
        render(<Harness role="Mukadam" cachedGrant />);
        expect(screen.getByTestId('home-attendance')).toBeInTheDocument();
        expect(mayOpenAttendanceFromHome('SecondaryOwner', undefined)).toBe(true);
        expect(mayOpenAttendanceFromHome(null, undefined)).toBe(false);
        expect(mayOpenAttendanceFromHome('Worker', false)).toBe(false);
    });

    it('the running-cost card is re-homed here, names what it covers, and shows "—" (never ₹ 0) for nothing recorded', () => {
        render(<Harness />);
        expect(screen.getByTestId('running-cost-scope')).toHaveTextContent('खर्च: संपूर्ण शेत');
        expect(screen.getByTestId('running-cost-today')).toHaveTextContent('₹ 1,200');
        expect(screen.getByTestId('running-cost-yesterday')).toHaveTextContent('—');
        expect(screen.getByTestId('running-cost-so-far')).toHaveTextContent('₹ 45,000');
        expect(document.body.textContent).not.toContain('₹ 0');
    });

    it('no permanently disabled "श्रम साथीशी बोला" and no old guide card anywhere in the flow (H13)', () => {
        render(<Harness />);
        expect(document.body.textContent).not.toContain('श्रम साथीशी बोला');
        expect(screen.queryByTestId('sathi-guide-card')).toBeNull();
        fireEvent.click(screen.getByTestId('home-tell'));
        expect(document.body.textContent).not.toContain('श्रम साथीशी बोला');
        expect(document.body.textContent).not.toContain('आज कोणत्या प्लॉटवर काम केलं?');
        expect(screen.queryByTestId('sathi-guide-card')).toBeNull();
    });
});

describe('झालेले काम सांगा: crop first, then only that crop\'s plots, then the mic (LP-01, LP-02, H12)', () => {
    it('Sathi asks the founder\'s crop question; the plot step lists only the chosen crop\'s plots; the mic appears once a plot is chosen', () => {
        const onChooseVoice = vi.fn();
        render(<Harness onChooseVoice={onChooseVoice} />);
        fireEvent.click(screen.getByTestId('home-tell'));

        expect(screen.getByTestId('flow-sathi-question')).toHaveTextContent('कोणत्या पिकावर काम झालं ?');
        expect(screen.getByTestId('flow-sathi-hint')).toHaveTextContent('खालील पैकी योग्य पीक निवडा');
        expect(screen.getByTestId('flow-crop-cane')).toBeInTheDocument();
        expect(screen.getByTestId('flow-crop-grape')).toBeInTheDocument();
        expect(screen.queryByTestId('fake-recorder')).toBeNull();

        fireEvent.click(screen.getByTestId('flow-crop-grape'));
        expect(screen.getByTestId('flow-sathi-question')).toHaveTextContent('द्राक्ष मधील आज कोणत्या प्लॉट वर काम झालं ?');
        expect(screen.getByTestId('flow-plot-grape-1')).toHaveTextContent('सोनाका');
        expect(screen.getByTestId('flow-plot-grape-2')).toHaveTextContent('थॉम्पसन');
        expect(screen.queryByTestId('flow-plot-cane-1')).toBeNull();
        expect(screen.queryByTestId('fake-recorder')).toBeNull();

        fireEvent.click(screen.getByTestId('flow-plot-grape-2'));
        expect(screen.getByTestId('fake-recorder')).toBeInTheDocument();
        expect(onChooseVoice).toHaveBeenCalled();
        // the REAL scope the app logs against
        expect(scopeNow().selectedCropIds).toEqual(['grape']);
        expect(scopeNow().selectedPlotIds).toEqual(['grape-2']);

        // several plots allowed, as the real selector allows
        fireEvent.click(screen.getByTestId('flow-plot-grape-1'));
        expect(scopeNow().selectedPlotIds).toEqual(['grape-2', 'grape-1']);
        expect(scopeNow().mode).toBe('multi');
    });

    it('the entire-farm picture tile leads straight to the mic, with Sathi\'s plain line', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('home-tell'));
        const tile = screen.getByTestId('flow-crop-whole-farm');
        expect(tile.querySelector('img')?.getAttribute('src')).toBe('/images/farm/entire-farm.svg');
        fireEvent.click(tile);
        expect(screen.getByTestId('flow-sathi-question')).toHaveTextContent('प्लॉटला न जोडता येणाऱ्या कामासाठी');
        expect(screen.getByTestId('fake-recorder')).toBeInTheDocument();
        expect(scopeNow().selectedCropIds).toEqual(['FARM_GLOBAL']);
    });

    it('while the mic listens the choices hide but the recorder stays mounted (it is not thrown away)', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('home-tell'));
        fireEvent.click(screen.getByTestId('flow-crop-cane'));
        fireEvent.click(screen.getByTestId('flow-plot-cane-1'));
        const recorder = screen.getByTestId('fake-recorder');
        fireEvent.click(screen.getByTestId('fake-start'));
        expect(screen.getByTestId('flow-choices')).toHaveClass('hidden');
        expect(screen.getByTestId('fake-recorder')).toBe(recorder);
        fireEvent.click(screen.getByTestId('fake-stop'));
        expect(screen.getByTestId('flow-choices')).not.toHaveClass('hidden');
    });
});

describe('back is ONE step on a big labelled "मागे", never out of the app (LP-03)', () => {
    it('mic/plots -> crop -> work home, each on "मागे"', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('home-tell'));
        fireEvent.click(screen.getByTestId('flow-crop-cane'));
        fireEvent.click(screen.getByTestId('flow-plot-cane-2'));
        expect(screen.getByTestId('fake-recorder')).toBeInTheDocument();

        expect(screen.getByTestId('flow-back')).toHaveTextContent('मागे');
        fireEvent.click(screen.getByTestId('flow-back'));
        expect(screen.getByTestId('flow-sathi-question')).toHaveTextContent('कोणत्या पिकावर काम झालं ?');
        expect(scopeNow().selectedPlotIds).toEqual([]);

        expect(screen.getByTestId('entry-back-home')).toHaveTextContent('मागे');
        fireEvent.click(screen.getByTestId('entry-back-home'));
        expect(screen.getByTestId('work-home')).toBeInTheDocument();
    });

    it('Android hardware back follows the same steps, and the home lets the app handle it', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('home-tell'));
        fireEvent.click(screen.getByTestId('flow-crop-cane'));
        fireEvent.click(screen.getByTestId('flow-plot-cane-1'));
        act(() => { expect(dismissTopOverlay()).toBe(true); });
        expect(screen.getByTestId('log-entry-flow')).toHaveAttribute('data-step', 'crop');
        act(() => { expect(dismissTopOverlay()).toBe(true); });
        expect(screen.getByTestId('work-home')).toBeInTheDocument();
        expect(dismissTopOverlay()).toBe(false);
    });

    it('arriving from the हजेरी mic: no home, and back from the crop question returns to हजेरी', () => {
        const onBackToLabour = vi.fn();
        render(<Harness labourIntent onBackToLabour={onBackToLabour} />);
        expect(screen.queryByTestId('work-home')).toBeNull();
        expect(screen.getByTestId('flow-sathi-question')).toHaveTextContent('कोणत्या पिकावर काम झालं ?');
        fireEvent.click(screen.getByTestId('entry-back-home'));
        expect(onBackToLabour).toHaveBeenCalledTimes(1);
    });

    it('arriving from हजेरी, the plot step asks the founder\'s हजेरी question (2026-08-31 ruling), not the generic one (I12-V1-m1)', () => {
        render(<Harness labourIntent />);
        fireEvent.click(screen.getByTestId('flow-crop-grape'));
        expect(screen.getByTestId('flow-sathi')).toHaveAttribute('data-labour', 'yes');
        expect(screen.getByTestId('flow-sathi-question')).toHaveTextContent('आज कोणत्या प्लॉटवर कोणी काम केलं, त्यांची हजेरी घ्या किंवा ओळख पटवून द्या.');
        expect(screen.getByTestId('flow-sathi-hint')).toHaveTextContent('शक्य तेवढ्या सगळ्यांची नावं घ्या');
        expect(screen.getByTestId('flow-sathi-question')).not.toHaveTextContent('मधील आज कोणत्या प्लॉट वर काम झालं');
        // the ordinary door keeps the founder's own plot question
        cleanup();
        render(<Harness />);
        fireEvent.click(screen.getByTestId('home-tell'));
        fireEvent.click(screen.getByTestId('flow-crop-grape'));
        expect(screen.getByTestId('flow-sathi')).not.toHaveAttribute('data-labour');
        expect(screen.getByTestId('flow-sathi-question')).toHaveTextContent('द्राक्ष मधील आज कोणत्या प्लॉट वर काम झालं ?');
    });
});

describe('no English on the entry steps, whatever the app language (LP-27, I12-V1-m3)', () => {
    // No LanguageProvider here: the shared selector falls back to ENGLISH, the worst case.
    it('the "संपूर्ण शेत" tile and its line are Marathi, and no Latin letter shows on the crop or plot step', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('home-tell'));
        const tile = screen.getByTestId('flow-crop-whole-farm');
        expect(tile).toHaveTextContent('संपूर्ण शेत');
        expect(tile).toHaveTextContent('प्लॉटनुसार सांगता येत नसेल तेव्हा निवडा');
        expect(document.body.textContent).not.toContain('Entire Farm');
        expect(screen.getByTestId('log-entry-flow').textContent).not.toMatch(/[A-Za-z]/);

        fireEvent.click(screen.getByTestId('flow-crop-cane'));
        expect(screen.getByTestId('flow-choices').textContent).not.toMatch(/[A-Za-z]/);

        fireEvent.click(screen.getByTestId('flow-back'));
        fireEvent.click(screen.getByTestId('flow-crop-whole-farm'));
        expect(screen.getByTestId('flow-crop-chip')).toHaveTextContent('संपूर्ण शेत');
        expect(screen.getByTestId('flow-choices').textContent).not.toMatch(/[A-Za-z]/);
    });
});

describe('tapping the आजची कामे tab again returns to the work home, fresh', () => {
    it('from the mic step: home, selection cleared, the request acknowledged', () => {
        const onHomeRequestHandled = vi.fn();
        const { rerender } = render(<Harness onHomeRequestHandled={onHomeRequestHandled} />);
        fireEvent.click(screen.getByTestId('home-tell'));
        fireEvent.click(screen.getByTestId('flow-crop-cane'));
        fireEvent.click(screen.getByTestId('flow-plot-cane-1'));
        rerender(<Harness homeRequested onHomeRequestHandled={onHomeRequestHandled} />);
        expect(onHomeRequestHandled).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('work-home')).toBeInTheDocument();
        expect(scopeNow().selectedCropIds).toEqual([]);
        // and "tell" starts at the crop question again
        rerender(<Harness homeRequested={false} onHomeRequestHandled={onHomeRequestHandled} />);
        fireEvent.click(screen.getByTestId('home-tell'));
        expect(screen.getByTestId('flow-sathi-question')).toHaveTextContent('कोणत्या पिकावर काम झालं ?');
    });

    it('never while the mic is listening — his words are not thrown away', () => {
        const onHomeRequestHandled = vi.fn();
        const { rerender } = render(<Harness onHomeRequestHandled={onHomeRequestHandled} />);
        fireEvent.click(screen.getByTestId('home-tell'));
        fireEvent.click(screen.getByTestId('flow-crop-cane'));
        fireEvent.click(screen.getByTestId('flow-plot-cane-1'));
        fireEvent.click(screen.getByTestId('fake-start'));
        rerender(<Harness homeRequested onHomeRequestHandled={onHomeRequestHandled} />);
        expect(onHomeRequestHandled).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('work-home')).toBeNull();
        expect(screen.getByTestId('fake-recorder')).toBeInTheDocument();
    });

    it('a tab tap that opens the tab with an old selection still lands on the home', () => {
        const initial: LogScope = { selectedCropIds: ['cane'], selectedPlotIds: ['cane-1'], mode: 'single', applyPolicy: 'broadcast' };
        render(<Harness initialScope={initial} homeRequested />);
        expect(screen.getByTestId('work-home')).toBeInTheDocument();
        expect(scopeNow().selectedPlotIds).toEqual([]);
    });

    it('without a tab tap, a live selection (e.g. back from the saved card) reopens on the mic', () => {
        const initial: LogScope = { selectedCropIds: ['cane'], selectedPlotIds: ['cane-1'], mode: 'single', applyPolicy: 'broadcast' };
        render(<Harness initialScope={initial} />);
        expect(screen.getByTestId('fake-recorder')).toBeInTheDocument();
    });
});

describe('lane E1 — the old hand-filled form is not a step of this flow any more', () => {
    it('from the mic there is no way into a form: the flow is home → crop → plots + mic only', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('home-tell'));
        fireEvent.click(screen.getByTestId('flow-crop-cane'));
        fireEvent.click(screen.getByTestId('flow-plot-cane-1'));
        expect(screen.getByTestId('fake-recorder')).toBeInTheDocument();
        expect(screen.queryByTestId('form-typed-tag')).toBeNull();
        expect(screen.queryByTestId('log-entry-flow')?.getAttribute('data-step')).not.toBe('form');
    });
});

describe('lane MIC-1 — the ONE mic opens this flow when the place is not known', () => {
    it('starts on the crop question (no work home), shows its band above the mic, and its back leaves the flow', () => {
        const onExit = vi.fn();
        render(<Harness startAt="entry" onExit={onExit} micLead={<div data-testid="the-band">band</div>} />);
        expect(screen.queryByTestId('home-tell')).toBeNull();
        expect(screen.getByTestId('log-entry-flow')).toHaveAttribute('data-step', 'crop');
        fireEvent.click(screen.getByTestId('entry-back-home'));
        expect(onExit).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByTestId('flow-crop-cane'));
        fireEvent.click(screen.getByTestId('flow-plot-cane-1'));
        expect(screen.getByTestId('the-band')).toBeInTheDocument();
        expect(screen.getByTestId('fake-recorder')).toBeInTheDocument();
    });
});

describe('saying one part again (recordingSegment)', () => {
    it('goes straight to the mic with a Marathi band and a Marathi cancel — no English', () => {
        const onCancelSegment = vi.fn();
        render(<Harness recordingSegment="labour" onCancelSegment={onCancelSegment} />);
        expect(screen.getByTestId('segment-banner')).toHaveTextContent('मजूर — पुन्हा सांगा');
        expect(screen.getByTestId('fake-recorder')).toBeInTheDocument();
        expect(document.body.textContent).not.toMatch(/Recording|Speak|Cancel & Go Back/);
        fireEvent.click(screen.getByTestId('segment-cancel'));
        expect(onCancelSegment).toHaveBeenCalledTimes(1);
    });
});
