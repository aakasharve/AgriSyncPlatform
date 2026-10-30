// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane MIC-1) — ONE mic for the whole app, on a stand-in app state.
 *
 *   - `requestSpeak` opens THE log recorder over the screen he is on, at once (no route change); a known place skips
 *     the crop → plot pickers (its scope is set before paint); an unknown place shows the log tab's crop → plot flow;
 *   - after he speaks: the waiting screen, then back to the screen he started on — for EVERY purpose — with what he
 *     said handed to it (`onLanded`): saved log ids, or (a correction) the understood words, never saved;
 *   - a draft already waiting on the log tab is never touched: he is taken to it;
 *   - back before speaking saves nothing; an error keeps him on the mic; Sathi's question skipped is recorded honestly;
 *   - a screen other than the log tab leaves the log tab as it was (its success screen cleared, its plots restored).
 * The recorder and the waiting screen are stand-ins here (`logRecorder.tsx` is the real one, tested with the log tab).
 */
import '@testing-library/jest-dom/vitest';
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const abandon = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../../features/logs/services/pendingQuestionAnswer', () => ({ abandonPendingQuestionAnswer: abandon }));
vi.mock('../../navigation/logRecorder', () => ({
    renderLogRecorder: (ctx: { isContextReady: boolean; logScope: { selectedPlotIds: string[] } }) => (
        <div data-testid="the-recorder" data-ready={ctx.isContextReady ? 'yes' : 'no'} data-plots={ctx.logScope.selectedPlotIds.join(',')} />
    ),
    renderProcessingScreen: () => <div data-testid="the-waiting-screen" />,
}));
vi.mock('../../../features/logs/components/entry/LogEntryFlow', () => ({
    LogEntryFlow: (p: { startAt?: string; onExit?: () => void; micLead?: React.ReactNode }) => (
        <div data-testid="picker-flow" data-start={p.startAt}>{p.micLead}<button type="button" data-testid="picker-exit" onClick={p.onExit}>x</button></div>
    ),
}));
vi.mock('../../../infrastructure/storage/AuthTokenStore', () => ({ getSessionUserId: () => 'me' }));

import type { AppStatus, LogScope } from '../../../types';
import type { AppRouterContext } from '../../navigation/routeContext';
import { SpeakHost } from '../SpeakHost';
import { withSpeakPurpose } from '../speakFlow';
import { requestSpeak, resetSpeakStoreForTests, speakState, type SpeakLanding, type SpeakPurpose, type SpeakRequestInput } from '../speakStore';

const EMPTY: LogScope = { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' };
const CROPS = [{ id: 'grape', name: 'Grapes', iconName: 'Grapes', color: 'x', plots: [{ id: 'g1', name: 'सोनाका' }] }];

interface AppState {
    status: AppStatus; draftLog: unknown; lastSavedLogIds: string[]; logScope: LogScope; mode: 'voice' | 'manual';
    currentRoute: string; mainView: string;
}
const spies = { handleReset: vi.fn(), setMode: vi.fn(), setCurrentRoute: vi.fn(), setMainView: vi.fn(), setLogScope: vi.fn(), setStatus: vi.fn() };
let drive: { set: (next: Partial<AppState>) => void; get: () => AppState } = { set: () => undefined, get: () => ({}) as AppState };

const Harness: React.FC<{ start: Partial<AppState> }> = ({ start }) => {
    const [s, setS] = useState<AppState>({ status: 'idle', draftLog: null, lastSavedLogIds: [], logScope: EMPTY, mode: 'voice', currentRoute: 'main', mainView: 'reflect', ...start });
    drive = { set: next => setS(prev => ({ ...prev, ...next })), get: () => s };
    const ctx = {
        ...s,
        crops: CROPS, history: [], farmerProfile: { operators: [], activeOperatorId: 'me' }, farmRole: 'PrimaryOwner',
        isContextReady: s.logScope.selectedCropIds.length > 0,
        handleReset: () => { spies.handleReset(); setS(prev => ({ ...prev, status: 'idle', draftLog: null })); },
        setMode: (m: 'voice' | 'manual') => { spies.setMode(m); setS(prev => ({ ...prev, mode: m })); },
        setStatus: (st: AppStatus) => { spies.setStatus(st); setS(prev => ({ ...prev, status: st })); },
        setLogScope: (sc: LogScope) => { spies.setLogScope(sc); setS(prev => ({ ...prev, logScope: sc })); },
        setCurrentRoute: (r: string) => { spies.setCurrentRoute(r); setS(prev => ({ ...prev, currentRoute: r })); },
        setMainView: (v: string) => { spies.setMainView(v); setS(prev => ({ ...prev, mainView: v })); },
    } as unknown as AppRouterContext;
    return (
        <>
            <SpeakHost ctx={ctx} />
            <output data-testid="where">{`${s.currentRoute}/${s.mainView}`}</output>
        </>
    );
};

/**
 * What the voice pipeline does after the mic: the waiting screen, then the auto-save's success (its new log ids). On
 * the log tab the tab draws the waiting screen itself, so the mic's own frame steps aside (one waiting screen, not two).
 */
const speakAndSave = (logIds: string[], onLogTab: boolean) => {
    act(() => drive.set({ status: 'processing' }));
    if (onLogTab) expect(screen.queryByTestId('speak-screen')).toBeNull();
    else expect(screen.getByTestId('the-waiting-screen')).toBeInTheDocument();
    act(() => drive.set({ status: 'success', lastSavedLogIds: logIds }));
};
/** A correction's words: the recorder's hand-off, purpose-aware — held for the screen, never saved. */
const speakCorrection = async (autoSave: ReturnType<typeof vi.fn>) => {
    act(() => drive.set({ status: 'processing' }));
    const sink = withSpeakPurpose(autoSave as never, { setStatus: st => drive.set({ status: st }) });
    await act(async () => { await sink({ inputs: [{ id: 'x' }] } as never, undefined, { recordedAtUtc: 'T', clipId: null } as never); });
};

beforeEach(() => { resetSpeakStoreForTests(); Object.values(spies).forEach(s => s.mockClear()); abandon.mockClear(); });
afterEach(() => { cleanup(); resetSpeakStoreForTests(); });

const plotPlace = { cropId: 'grape', plotId: 'g1' };
interface Row { purpose: SpeakPurpose; context: SpeakRequestInput['context']; origin: { route: string; mainView: string } }
/** The test table of routed purposes: each returns to where it started. */
const TABLE: Row[] = [
    { purpose: 'addToDay', context: { place: plotPlace }, origin: { route: 'main', mainView: 'reflect' } },
    { purpose: 'fillPart', context: { place: 'current', part: 'labour' }, origin: { route: 'main', mainView: 'log' } },
    { purpose: 'answerQuestion', context: { place: 'current', question: 'आज किती मजूर होते?' }, origin: { route: 'main', mainView: 'log' } },
    { purpose: 'addTodo', context: { place: { cropId: 'FARM_GLOBAL' } }, origin: { route: 'main', mainView: 'reflect' } },
    { purpose: 'attention', context: { place: plotPlace }, origin: { route: 'attention', mainView: 'reflect' } },
    { purpose: 'scheduleDone', context: { place: plotPlace }, origin: { route: 'schedule', mainView: 'reflect' } },
    { purpose: 'addToDay', context: {}, origin: { route: 'procurement', mainView: 'reflect' } },
];

describe('requestSpeak returns to the origin for each purpose (saved words)', () => {
    it.each(TABLE)('$purpose from $origin.route/$origin.mainView', ({ purpose, context, origin }) => {
        const prevScope: LogScope = { selectedCropIds: ['other'], selectedPlotIds: ['o1'], mode: 'single', applyPolicy: 'broadcast' };
        render(<Harness start={{ currentRoute: origin.route, mainView: origin.mainView, logScope: context?.place === 'current' ? { ...EMPTY, selectedCropIds: ['grape'], selectedPlotIds: ['g1'] } : prevScope, ...(origin.mainView === 'log' ? { status: 'success', lastSavedLogIds: ['old'] } : {}) }} />);
        const onLanded = vi.fn<(l: SpeakLanding) => void>();
        act(() => { requestSpeak({ purpose, context, returnTo: origin as SpeakRequestInput['returnTo'], onLanded }); });

        // at once, over the screen he is on: THE recorder (or the pickers when the place is not known)
        expect(screen.getByTestId('speak-screen')).toHaveAttribute('data-purpose', purpose);
        if (context?.place) {
            expect(screen.getByTestId('the-recorder')).toHaveAttribute('data-ready', 'yes');
            if (context.place !== 'current' && 'plotId' in context.place) expect(screen.getByTestId('the-recorder')).toHaveAttribute('data-plots', 'g1');
            expect(screen.queryByTestId('picker-flow')).toBeNull();
        } else {
            expect(screen.getByTestId('picker-flow')).toHaveAttribute('data-start', 'entry');
        }
        expect(screen.getByTestId('where')).toHaveTextContent(`${origin.route}/${origin.mainView}`);

        speakAndSave(['new-1', 'new-2'], origin.route === 'main' && origin.mainView === 'log');
        expect(onLanded).toHaveBeenCalledWith({ kind: 'saved', logIds: ['new-1', 'new-2'] });
        expect(speakState().request).toBeNull();
        expect(screen.queryByTestId('speak-screen')).toBeNull();
        expect(screen.getByTestId('where')).toHaveTextContent(`${origin.route}/${origin.mainView}`);
        if (origin.route === 'main' && origin.mainView === 'log') {
            // the result screen he started on now shows the new recording: nothing reset under him
            expect(spies.handleReset).not.toHaveBeenCalled();
        } else {
            // the log tab is left as it was: its success screen cleared, its plots put back
            expect(spies.handleReset).toHaveBeenCalledTimes(1);
            expect(drive.get().logScope).toEqual(prevScope);
        }
    });

    it('correctEntry: the understood words come back to the "बदला" screen and nothing is saved', async () => {
        render(<Harness start={{ currentRoute: 'main', mainView: 'reflect' }} />);
        const onLanded = vi.fn<(l: SpeakLanding) => void>();
        act(() => { requestSpeak({ purpose: 'correctEntry', context: { place: plotPlace, logId: 'log-1' }, returnTo: { route: 'main', mainView: 'reflect' }, onLanded }); });
        const autoSave = vi.fn(async () => true);
        await speakCorrection(autoSave);
        expect(autoSave).not.toHaveBeenCalled();
        expect(onLanded).toHaveBeenCalledWith({ kind: 'parsed', draft: expect.objectContaining({ inputs: [{ id: 'x' }] }), typed: false });
        expect(speakState().request).toBeNull();
        expect(screen.getByTestId('where')).toHaveTextContent('main/reflect');
        expect(drive.get().logScope).toEqual(EMPTY); // the log tab's plots put back
    });

    it('correctEntry from the result screen: the result screen comes back (never the old form an idle flow would draw)', async () => {
        render(<Harness start={{ currentRoute: 'main', mainView: 'log', status: 'success', mode: 'manual', lastSavedLogIds: ['old'] }} />);
        act(() => { requestSpeak({ purpose: 'correctEntry', context: { place: plotPlace, logId: 'old' }, returnTo: { route: 'main', mainView: 'log' } }); });
        expect(drive.get().mode).toBe('voice'); // an idle flow under it can only be the mic
        await speakCorrection(vi.fn(async () => true));
        expect(drive.get().status).toBe('success');
    });
});

describe('the ONE mic keeps everything else safe', () => {
    it('a parsed draft waiting on the log tab is never touched: he is taken to it (handedOver)', () => {
        render(<Harness start={{ currentRoute: 'main', mainView: 'reflect', draftLog: { summary: 'waiting' } }} />);
        const onLanded = vi.fn();
        act(() => { requestSpeak({ purpose: 'addToDay', context: { place: plotPlace }, returnTo: { route: 'main', mainView: 'reflect' }, onLanded }); });
        expect(onLanded).toHaveBeenCalledWith({ kind: 'handedOver' });
        expect(screen.queryByTestId('speak-screen')).toBeNull();
        expect(screen.getByTestId('where')).toHaveTextContent('main/log');
        expect(spies.setLogScope).not.toHaveBeenCalled();
        expect(drive.get().draftLog).toEqual({ summary: 'waiting' });
    });

    it('back before speaking saves nothing and returns him; Sathi\'s question skipped is recorded honestly', () => {
        render(<Harness start={{ currentRoute: 'main', mainView: 'log', status: 'success', lastSavedLogIds: ['old'], logScope: { ...EMPTY, selectedCropIds: ['grape'], selectedPlotIds: ['g1'] } }} />);
        const onLanded = vi.fn();
        act(() => { requestSpeak({ purpose: 'answerQuestion', context: { place: 'current', question: 'किती?' }, returnTo: { route: 'main', mainView: 'log' }, onLanded }); });
        expect(screen.getByTestId('speak-band-hint')).toHaveTextContent('किती?');
        fireEvent.click(screen.getByTestId('speak-back'));
        expect(onLanded).toHaveBeenCalledWith({ kind: 'cancelled' });
        expect(abandon).toHaveBeenCalledTimes(1);
        expect(spies.handleReset).not.toHaveBeenCalled();
        expect(drive.get().status).toBe('success');
    });

    it('an error after speaking keeps him on the mic (the recorder says what went wrong); back then restores the screen under it', () => {
        render(<Harness start={{ currentRoute: 'main', mainView: 'log', status: 'success', lastSavedLogIds: ['old'] }} />);
        act(() => { requestSpeak({ purpose: 'addToDay', context: { place: plotPlace }, returnTo: { route: 'main', mainView: 'log' } }); });
        act(() => drive.set({ status: 'processing' }));
        act(() => drive.set({ status: 'idle' })); // the parse failed: no save, no draft
        expect(screen.getByTestId('speak-screen')).toBeInTheDocument();
        expect(screen.getByTestId('the-recorder')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('speak-back'));
        expect(drive.get().status).toBe('success'); // his result screen is back, not an empty flow
    });

    it('his words need the review (the auto-save declined them): he is taken to the log tab where they wait — never lost', () => {
        render(<Harness start={{ currentRoute: 'main', mainView: 'reflect' }} />);
        const onLanded = vi.fn();
        act(() => { requestSpeak({ purpose: 'addToDay', context: { place: plotPlace }, returnTo: { route: 'main', mainView: 'reflect' }, onLanded }); });
        act(() => drive.set({ status: 'processing' }));
        act(() => drive.set({ status: 'idle', draftLog: { summary: 'review me' } }));
        expect(onLanded).toHaveBeenCalledWith({ kind: 'handedOver' });
        expect(screen.getByTestId('where')).toHaveTextContent('main/log');
        expect(drive.get().logScope.selectedPlotIds).toEqual(['g1']); // the review saves under THIS plot
    });

    it('an unknown place: the crop → plot flow, with the band above the mic; its back leaves without saving', () => {
        render(<Harness start={{ currentRoute: 'tests', mainView: 'reflect' }} />);
        const onLanded = vi.fn();
        act(() => { requestSpeak({ purpose: 'addToDay', returnTo: { route: 'tests', mainView: 'reflect' }, onLanded }); });
        expect(screen.getByTestId('speak-band')).toBeInTheDocument();
        expect(screen.queryByTestId('speak-back')).toBeNull(); // the picker's own back is the way out
        fireEvent.click(screen.getByTestId('picker-exit'));
        expect(onLanded).toHaveBeenCalledWith({ kind: 'cancelled' });
        expect(screen.getByTestId('where')).toHaveTextContent('tests/reflect');
    });
});

describe.each(['mr', 'en'] as const)('the band says why he is speaking (%s)', language => {
    it('fillPart names the part; correctEntry says what to do', async () => {
        vi.resetModules();
        vi.doMock('../../../i18n/LanguageContext', () => ({ useOptionalLanguage: () => ({ language }), useLanguage: () => ({ language }) }));
        const { speakWords } = await import('../speakWords');
        const w = speakWords(language);
        expect(w.band('fillPart', { part: 'labour' }).title).toBe(language === 'en' ? 'Tell the labour' : 'मजूर सांगा');
        expect(w.band('correctEntry', {}).title).toBe(language === 'en' ? 'Say what should change' : 'जे बदलायचं ते बोलून सांगा');
        expect(w.back).toBe(language === 'en' ? 'Back' : 'मागे');
        vi.doUnmock('../../../i18n/LanguageContext');
    });
});

describe('fix pass — B009 (language strict) and B006 (never a mic that cannot start)', () => {
    it('B009: English mode never shows Sathi\'s Marathi prompt in the band; Marathi mode shows it', async () => {
        const { speakWords } = await import('../speakWords');
        const devanagari = /[ऀ-ॿ]/;
        const en = speakWords('en').band('answerQuestion', { question: 'आज किती मजूर होते?' });
        expect(devanagari.test(`${en.title} ${en.hint ?? ''}`)).toBe(false);
        expect(speakWords('mr').band('answerQuestion', { question: 'आज किती मजूर होते?' }).hint).toBe('आज किती मजूर होते?');
        for (const purpose of ['addToDay', 'fillPart', 'correctEntry', 'addTodo', 'attention', 'scheduleDone'] as const) {
            const b = speakWords('en').band(purpose, { part: 'labour', question: 'मराठी प्रश्न' });
            expect(devanagari.test(`${b.title} ${b.hint ?? ''}`)).toBe(false);
        }
    });

    it('B006: a crop-level entry\'s "बदला" mic opens on the whole farm (a place the recorder can use), never a crop with no plot', async () => {
        const { placeOfLog } = await import('../SpeakHost');
        const cropLevel = { context: { selection: [{ cropId: 'grape', cropName: 'Grapes', selectedPlotIds: [], selectedPlotNames: [] }] } } as never;
        expect(placeOfLog(cropLevel)).toEqual({ cropId: 'FARM_GLOBAL' });
        const plot = { context: { selection: [{ cropId: 'grape', cropName: 'Grapes', selectedPlotIds: ['g1'], selectedPlotNames: ['सोनाका'] }] } } as never;
        expect(placeOfLog(plot)).toEqual({ cropId: 'grape', plotId: 'g1' });
    });
});
