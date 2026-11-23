/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 13) — the dev-only preview's voice harness walks the real save path's events in
 * their real order, saves through the real factory (in memory), and says "success" only after the write; the fixtures
 * carry what the founder clicks through (3 products, two speakers on the plot); the preview's data source refuses writes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VoiceResultState } from '../../../../app/hooks/useVoiceAutoSave';
import type { LastSavedLogSummaryItem } from '../../../../app/uiRuntimeTypes';
import { readVoiceJourney, resetVoiceJourneyForTests, subscribeVoiceJourney, type VoiceJourneySnapshot } from '../../../../infrastructure/voice/voiceJourneySignal';
import { productBoxesOf } from '../../../logs/components/voiceResult/productModel';
import type { AppStatus, DailyLog, LogScope } from '../../../../types';
import { PREVIEW_CROPS, PREVIEW_FARMER_PROFILE, buildPreviewLogs } from '../previewAppFixtures';
import { PREVIEW_DATA_SOURCE, PREVIEW_SAVE_REFUSED } from '../previewDataSource';
import { runPreviewVoiceJourney } from '../previewVoiceJourney';
import {
    PREVIEW_V2_DRAFT, PREVIEW_V2_MUKADAM, PREVIEW_V2_PLOT, PREVIEW_V2_TRANSCRIPT, PREVIEW_V2_UNCLEAR, buildPreviewV2EarlierLog, previewV2History,
} from '../voiceFlowV2Fixtures';

const scope: LogScope = { selectedCropIds: [PREVIEW_V2_PLOT.cropId], selectedPlotIds: [PREVIEW_V2_PLOT.plotId], mode: 'single', applyPolicy: 'broadcast' };
const TODAY = '2026-11-23';

/** What changed, in order: the journey's steps (from the signal) and the harness's own calls. */
function harness(input: 'audio' | 'text' = 'audio') {
    const trail: string[] = [];
    let history: DailyLog[] = [buildPreviewV2EarlierLog(TODAY)];
    let result: VoiceResultState | null = null;
    let saved: { ids: string[]; summary: LastSavedLogSummaryItem[] } | null = null;
    let last: VoiceJourneySnapshot | null = null;
    const unsubscribe = subscribeVoiceJourney(() => {
        const s = readVoiceJourney();
        if (s?.writtenAt !== undefined && last?.writtenAt === undefined) trail.push('written');
        else if (s?.placeAt !== undefined && last?.placeAt === undefined) trail.push(`placeChecked:${s.place}`);
        else if (s?.understoodAt !== undefined && last?.understoodAt === undefined) trail.push('understood');
        else if (s && s.startedAt !== last?.startedAt) trail.push(`kept:${s.input}`);
        last = s;
    });
    let clock = 1_000_000;
    const run = runPreviewVoiceJourney({
        input, durationMs: input === 'audio' ? 12_400 : undefined, scope, crops: PREVIEW_CROPS, profile: PREVIEW_FARMER_PROFILE,
        setStatus: (status: AppStatus) => trail.push(`status:${status}`),
        setHistory: next => { history = typeof next === 'function' ? next(history) : next; trail.push('history'); },
        setVoiceResult: r => { result = r; trail.push('result'); },
        setLastSaved: (ids, summary) => { saved = { ids, summary }; trail.push('lastSaved'); },
        wait: async () => { clock += 600; },
        now: () => clock,
    });
    return { run, trail, unsubscribe, get history() { return history; }, get result() { return result; }, get saved() { return saved; } };
}

beforeEach(() => resetVoiceJourneyForTests());
afterEach(() => resetVoiceJourneyForTests());

describe('runPreviewVoiceJourney — the real events, in the real order', () => {
    it('kept → understood → placeChecked → written, and "success" only after the write', async () => {
        const h = harness();
        const logs = await h.run;
        h.unsubscribe();
        expect(h.trail).toEqual([
            'status:processing', 'kept:audio', 'understood', 'placeChecked:same', 'history', 'result', 'lastSaved', 'written', 'status:success',
        ]);
        expect(readVoiceJourney()).toMatchObject({ input: 'audio', durationMs: 12_400, place: 'same', logIds: logs.map(l => l.id) });
    });

    it('adds the saved logs to the in-memory history, on the chosen plot, by the active operator, unconfirmed', async () => {
        const h = harness();
        const logs = await h.run;
        h.unsubscribe();
        expect(logs).toHaveLength(1);
        expect(h.history.map(l => l.id)).toEqual([logs[0].id, 'log-v2-pawar-earlier']);
        expect(logs[0].context.selection[0].selectedPlotIds).toEqual([PREVIEW_V2_PLOT.plotId]);
        expect(logs[0].meta?.createdByOperatorId).toBe(PREVIEW_FARMER_PROFILE.activeOperatorId);
        expect(logs[0].autoSavedFromVoice).toBe(true);
        expect(logs[0].fullTranscript).toBe(PREVIEW_V2_TRANSCRIPT);
    });

    it('the result state names these logs and the unclear phrase; nothing is claimed queued (syncQueued null)', async () => {
        const h = harness();
        const logs = await h.run;
        h.unsubscribe();
        expect(h.result).toMatchObject({ logIds: logs.map(l => l.id), clipId: null, unclear: [PREVIEW_V2_UNCLEAR] });
        expect(h.saved?.ids).toEqual(logs.map(l => l.id));
        expect(h.saved?.summary.every(s => s.syncQueued === null)).toBe(true);
    });

    it('typed words: kept as text, and the result says typed', async () => {
        const h = harness('text');
        await h.run;
        h.unsubscribe();
        expect(h.trail[1]).toBe('kept:text');
        expect(h.result?.typed).toBe(true);
    });

    it('the saved log carries three products: two in the spray tank, one in the drip release', async () => {
        const h = harness();
        const [log] = await h.run;
        h.unsubscribe();
        const boxes = productBoxesOf(log);
        expect(boxes.map(b => b.kind)).toEqual(['spray', 'drip']);
        expect(boxes[0].items.map(i => i.label)).toEqual(['कॉन्फिडॉर', 'युथेन एम-45']);
        expect(boxes[0].water).toEqual([{ litres: 200 }]);
        expect(boxes[1].items.map(i => i.npkGrade)).toEqual(['19:19:19']);
        expect(boxes[1].water).toEqual([{ hours: 2 }]);
    });
});

describe('voiceFlowV2Fixtures', () => {
    it('the parse holds what the founder clicks through', () => {
        expect(PREVIEW_V2_DRAFT.labour[0]).toMatchObject({ femaleCount: 7, maleCount: 3, count: 10 });
        expect(PREVIEW_V2_DRAFT.activityExpenses[0].totalAmount).toBe(600);
        expect(PREVIEW_V2_DRAFT.machinery[0]).toMatchObject({ type: 'tractor', implement: 'blower' });
        expect(PREVIEW_V2_DRAFT.plannedTasks?.[0].sourceText).toBe('परवा साफ मारायचं आहे');
        expect(PREVIEW_V2_DRAFT.unclearSegments).toHaveLength(1);
        // Every phrase the parse kept is in his words (the transcript), so the screens can mark them there.
        const phrases = [...PREVIEW_V2_DRAFT.labour, ...PREVIEW_V2_DRAFT.inputs, ...PREVIEW_V2_DRAFT.irrigation, ...PREVIEW_V2_DRAFT.machinery,
            ...PREVIEW_V2_DRAFT.activityExpenses, ...PREVIEW_V2_DRAFT.cropActivities].map(x => x.sourceText ?? '');
        phrases.forEach(p => expect(PREVIEW_V2_TRANSCRIPT).toContain(p));
    });

    it('the earlier recording is on the same plot, by another speaker (the मुकादम), today', () => {
        const earlier = buildPreviewV2EarlierLog(TODAY);
        expect(earlier.date).toBe(TODAY);
        expect(earlier.context.selection[0].selectedPlotIds).toEqual([PREVIEW_V2_PLOT.plotId]);
        expect(earlier.meta?.createdByOperatorId).toBe(PREVIEW_V2_MUKADAM.id);
        expect(earlier.meta?.createdByOperatorId).not.toBe(PREVIEW_FARMER_PROFILE.activeOperatorId);
        expect(PREVIEW_V2_MUKADAM.role).toBe('MUKADAM');
    });

    it('previewV2History: the journey plot keeps only that one earlier recording today; everything else stays', () => {
        const seed = buildPreviewLogs();
        const today = seed[0].date;
        const history = previewV2History(seed, today);
        const onPlotToday = history.filter(l => l.date === today && l.context.selection.some(s => s.selectedPlotIds.includes(PREVIEW_V2_PLOT.plotId)));
        expect(onPlotToday.map(l => l.id)).toEqual(['log-v2-pawar-earlier']);
        expect(history.map(l => l.id)).toEqual(expect.arrayContaining(['log-rokade-2', 'log-jadhav-1', 'log-jadhav-2', 'log-shinde-1', 'log-rokade-old']));
    });

    it('ids stay Latin (the fixture rule)', () => {
        const ids = [PREVIEW_V2_MUKADAM.id, buildPreviewV2EarlierLog(TODAY).id, ...PREVIEW_V2_DRAFT.inputs.flatMap(i => [i.id, ...i.mix.map(m => m.id)])];
        ids.forEach(id => expect(id).toMatch(/^[a-z0-9-]+$/));
    });
});

describe('PREVIEW_DATA_SOURCE — the preview never saves', () => {
    it('every write is refused with the preview\'s words; reads answer nothing stored; the audit append resolves', async () => {
        const { dataSource, auditPort } = PREVIEW_DATA_SOURCE;
        await expect(dataSource.logs.save({} as DailyLog)).rejects.toThrow(PREVIEW_SAVE_REFUSED);
        await expect(dataSource.logs.batchSave([])).rejects.toThrow(PREVIEW_SAVE_REFUSED);
        await expect(dataSource.logs.updateVerification('x', 'VERIFIED' as never)).rejects.toThrow(PREVIEW_SAVE_REFUSED);
        await expect(dataSource.logs.getAll()).resolves.toEqual([]);
        await expect(dataSource.logs.getById('x')).resolves.toBeNull();
        await expect(auditPort.append({ actorId: 'a', action: 'VERIFY_LOG', resourceId: 'x' })).resolves.toBeUndefined();
    });
});
