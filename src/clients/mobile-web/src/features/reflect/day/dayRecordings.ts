/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane RF) — the work of ONE DAY on आढावा, recording by recording,
 * read the way the voice result screen reads it. Pure.
 *
 * Founder 2026-10-30: "a clarity of what work has been done, who has done it, when it was done, where you can listen".
 * So every piece of work here is a RECORDING (one save — the logs it became share one clock reading, one speaker and
 * one parse, `recordingKeyOf`), seen through the result screen's own model (`recordingOf`): what was understood,
 * who spoke it ("तुम्ही" for the person holding this phone), when, typed or spoken, confirmed or not, and whether the
 * server holds only its task lines (`legacyPartial`, lane F1).
 *
 * Rules kept (doctrine P4 / P7):
 *   - nothing is summed or worked out across recordings: each one keeps its own values, as said;
 *   - a recording that named several plots stays ONE recording; a plot's view of it shows what was understood FOR
 *     THAT PLOT (its own logs), with his words and his voice taken from the log that carries them;
 *   - a deleted log is not work done; a day with nothing told is empty, never zeros;
 *   - money the person holding this phone may not see becomes "—" (`withMoneyShown`), unless he said it himself.
 */
import type { CropProfile, DailyLog } from '../../../types';
import { workDoneOf } from '../../../core/navigation/activityFeedEntries';
import {
    PARTS, groupByRecording, primaryOf, recordingKeyOf, recordingOf,
    type PartEntry, type PartKey, type RecordingView, type WhoDeps,
} from '../../logs/components/voiceResult/resultModel';
import { isLogInScope, type PlotRef, type ViewScope } from '../overview/reflectSelection';

/** One recording of the day, as this page shows it. */
export interface DayRecording {
    /** The recording's own key (`recordingKeyOf`). */
    key: string;
    /** What the logs IN VIEW understood, who spoke, when, typed, confirmed, legacy — the result screen's view. */
    view: RecordingView;
    /** The log that carries his words: his voice (the clip on this phone, or the server's original) is asked by it. */
    voiceLog: DailyLog;
    /** The logs in view (one per plot it named, narrowed to the view). */
    logs: DailyLog[];
    /** The plots it is about, as named on the farm; empty = the whole farm. */
    plotNames: string[];
    cropColor: string;
    /** The first thing understood (the feed card's own rule, `workDoneOf`); "—" when nothing. */
    headline: string;
    /** When it was saved (ms), for the day's time order; unknown times go last. */
    at: number;
}

const FARM_GLOBAL = 'FARM_GLOBAL';
const UNKNOWN_TIME = Number.POSITIVE_INFINITY;
/** Shown in place of an amount the person holding this phone may not see. */
export const HIDDEN_MONEY = '—';

const createdMs = (log: DailyLog): number => {
    const ms = Date.parse(log.meta?.createdAtISO ?? '');
    return Number.isFinite(ms) ? ms : UNKNOWN_TIME;
};

/** The only stoppages ending this way are water the result model reads as "not given" (`blockersOf`). */
const WATER_STOPPED = ':stopped';
const partOrder = new Map(PARTS.map((p, i) => [p.key, i]));

/**
 * An older record kept only as task lines (lane F1, `legacyPartial`) carries its water as a bare "Irrigation" line:
 * no method, no hours, no reason. The result model reads such water as NOT given — a stoppage — but nothing in the
 * line says so. Here it is what the line says and no more: water was mentioned (the part, no value). Never a
 * stoppage that was not reported (P4).
 */
function withoutInventedStoppage(view: RecordingView, logs: readonly DailyLog[]): RecordingView {
    const legacy = new Set(logs.filter(l => l.legacyPartial === true).map(l => l.id));
    if (legacy.size === 0) return view;
    const invented = (id: string, logId: string) => legacy.has(logId) && id.endsWith(WATER_STOPPED);
    const water: PartEntry[] = view.blockers
        .filter(b => invented(b.id, b.logId))
        .map((b): PartEntry => ({ id: `${b.id.slice(0, -WATER_STOPPED.length)}:legacy`, logId: b.logId, part: 'irrigation', value: null, verified: true }));
    if (water.length === 0) return view;
    return {
        ...view,
        blockers: view.blockers.filter(b => !invented(b.id, b.logId)),
        entries: [...view.entries, ...water].sort((a, b) => (partOrder.get(a.part) ?? 0) - (partOrder.get(b.part) ?? 0)),
    };
}

/** The day's logs (deleted ones are not work done). */
export const dayLogsOf = (history: readonly DailyLog[], dateKey: string): DailyLog[] =>
    history.filter(l => l?.date === dateKey && !l.deletion);

/**
 * The recordings of one day that touch the view, in TIME ORDER (morning first). `inView` narrows which of a
 * recording's logs are shown (a plot's own, or every one).
 */
export function dayRecordings(
    history: readonly DailyLog[],
    dateKey: string,
    inView: (log: DailyLog) => boolean,
    deps: WhoDeps,
    crops: readonly CropProfile[],
): DayRecording[] {
    const out: DayRecording[] = [];
    for (const group of groupByRecording(dayLogsOf(history, dateKey))) {
        const logs = group.filter(inView);
        if (logs.length === 0) continue;
        const voiceLog = primaryOf(group) as DailyLog;
        const base = withoutInventedStoppage(recordingOf(logs, deps), logs);
        const words = (voiceLog.fullTranscript ?? '').trim();
        const plotNames = [...new Set(logs.flatMap(l => l.context?.selection?.flatMap(s => s.selectedPlotNames ?? []) ?? []).filter(Boolean))];
        const cropId = logs[0].context?.selection?.[0]?.cropId;
        out.push({
            key: recordingKeyOf(voiceLog),
            view: words ? { ...base, transcript: words } : base,
            voiceLog,
            logs,
            plotNames,
            cropColor: crops.find(c => c.id === cropId)?.color ?? 'bg-slate-400',
            headline: logs.map(workDoneOf).find(h => h !== '—') ?? '—',
            at: Math.min(...logs.map(createdMs), createdMs(voiceLog)),
        });
    }
    return out.sort((a, b) => a.at - b.at);
}

/** Every log of the day: the feed's view (the whole farm). */
export const anyLog = (): boolean => true;

/** One plot card's view: the logs about that plot (or, for a crop with no plot, that crop's own logs). */
export const plotLogFilter = (ref: Pick<PlotRef, 'cropId' | 'plotId'>) => (log: DailyLog): boolean => {
    const selection = log.context?.selection ?? [];
    if (ref.plotId) return selection.some(s => (s.selectedPlotIds ?? []).includes(ref.plotId as string));
    return selection.some(s => s.cropId === ref.cropId && (s.selectedPlotIds ?? []).length === 0);
};

/** The page's narrowed view (शेताची स्थिती), for the notes. */
export const scopeLogFilter = (scope: ViewScope) => (log: DailyLog): boolean => isLogInScope(log, scope);

/** A farm-wide log (no crop, no plot). */
export const isFarmWide = (log: DailyLog): boolean => log.context?.selection?.[0]?.cropId === FARM_GLOBAL;

/**
 * Money he may not see: every amount becomes "—" and loses its phrase (his phrase would repeat the amount). His own
 * recording keeps it — he said it. Every rupee figure of a recording lives in its खर्च part (`partEntriesOf`).
 */
export function withMoneyShown(rec: DayRecording, mayShow: boolean): DayRecording {
    if (mayShow || rec.view.who.you) return rec;
    const hide = (e: PartEntry): PartEntry => (e.part === 'expense' ? { ...e, value: HIDDEN_MONEY, quote: undefined } : e);
    return { ...rec, view: { ...rec.view, entries: rec.view.entries.map(hide) } };
}

/** The day, part by part (the result screen's `DayRow`s): each entry stays tied to its recording, newest first. */
export interface DayParts {
    byPart: Record<PartKey, PartEntry[]>;
    byLog: ReadonlyMap<string, RecordingView>;
}

export function dayPartsOf(recordings: readonly DayRecording[]): DayParts {
    const byPart = Object.fromEntries(PARTS.map(p => [p.key, [] as PartEntry[]])) as Record<PartKey, PartEntry[]>;
    const byLog = new Map<string, RecordingView>();
    for (const r of [...recordings].reverse()) {
        for (const id of r.view.logIds) byLog.set(id, r.view);
        for (const e of r.view.entries) byPart[e.part].push(e);
    }
    return { byPart, byLog };
}

/** The recording a log belongs to, among the day's. */
export const recordingOfLog = (recordings: readonly DayRecording[], logId: string): DayRecording | undefined =>
    recordings.find(r => r.view.logIds.includes(logId) || r.voiceLog.id === logId);
