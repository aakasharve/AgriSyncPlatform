/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6, WP-3; lane RF2 — the founder's screen 1, 2026-10-30)
 *
 * प्लॉटनिहाय काम — what one plot's card (and the "संपूर्ण शेत" card) says for the chosen day. Pure.
 *
 * Lane RF2: the eight numbered squares and their colour key are gone. The card shows ONLY what actually happened that
 * day, as chips, each in its part's colour and with its part's icon — the result screen's own (`PARTS`), read the
 * result screen's way (`partEntriesOf`, through `withoutInventedStoppage`):
 *   - values come from the stored record only, as said; nothing is computed;
 *   - nothing is summed across recordings (P4): labour told in two recordings is two chips ("5 बायका · 2 पुरुष", "10
 *     जण"); so is water, a spray, a machine, planned work — one chip per part per recording;
 *   - crop work is names, not amounts: the day's work names share one chip ("छाटणी · फवारणी");
 *   - his note is an "निरीक्षण" chip (one per note), a stoppage an "अडथळे" chip;
 *   - money is NOT read from the record: the card's money is the server ledger's for that plot that day
 *     (`moneyModel.plotDayMoney`, passed in, gated by `mayShowFarmMoney` there) — the record's own amounts (a wage, a
 *     spray's cost) are left to the plot's day view, where they are masked the RF way;
 *   - an item the server could not verify keeps its "not sure" mark (`verified: false`), never a plain fact.
 * It keeps from lane RF: the status ("पक्कं नाही" / "✔ पक्कं केलं", confirmed only when EVERY recording is), how many
 * times the day was told, the plot's identity (crop, plot, variety, area, season day), water state, weather, and the
 * same non-deleted set of logs the day view shows (review B006).
 */
import type { CropPhase, DailyLog } from '../../../types';
import { entryText } from '../../logs/components/voiceResult/partNames';
import {
    PARTS, groupByRecording, isConfirmed, recordingKeyOf, recordingOf, withoutInventedStoppage,
    type PartEntry, type PartKey, type WhoDeps,
} from '../../logs/components/voiceResult/resultModel';
import { dayLogsOf, plotLogFilter } from '../day/dayRecordings';
import { getPhaseAndDay } from '../../../shared/utils/timelineUtils';
import { formatTemperature } from '../../../shared/utils/weatherFormatter';
import { getDayStatus, getIrrigationStatus } from '../helpers';
import type { MoneyFigure } from './moneyModel';
import type { PlotRef, ViewScope } from './reflectSelection';

const AREA_UNIT: Record<string, string> = { Acre: 'एकर', Guntha: 'गुंठे', Are: 'आर' };

export type WaterState = 'ON_TRACK' | 'MISSED' | 'EXTRA';
export const WATER_LABEL: Record<WaterState, string> = { ON_TRACK: 'पाणी वेळेवर', MISSED: 'पाणी चुकलं', EXTRA: 'जास्त पाणी' };

/** One thing that happened, as a chip: a part of the day (its colour and icon), or a stoppage. */
export interface DayChip {
    id: string;
    kind: PartKey | 'blocker';
    /** As said; '' when the part was mentioned with nothing more (the part's name stands for it). */
    text: string;
    /** False when the server could not find it in his words: shown with the "not sure" mark. */
    verified: boolean;
    /** The recording it came from; absent for crop work, whose names share one chip. */
    recordingKey?: string;
}

/** What a card (a plot's, or the whole farm's) says for the day. */
export interface DayCardCore {
    log?: DailyLog;
    status: 'worked' | 'blocked' | 'empty';
    stoppedReason?: string;
    /** Only what happened; empty = nothing told. */
    chips: DayChip[];
    /** The ledger's money for this place that day; absent when there is none to show. */
    money?: MoneyFigure;
    /** Every recording of the day is confirmed; absent when nothing was told. */
    confirmed?: boolean;
    /** How many recordings the day holds (0 = nothing told). */
    recordings: number;
}

export interface PlotDayCard extends DayCardCore {
    ref: PlotRef;
    weather?: { temp: string; condition: string };
    /** `2.5 एकर` — only when the plot records its area. */
    area?: string;
    /** `दिवस 25`, `जमीन तयारी · दिवस 3`, `जमीन तयारी`; absent when the plot has no season at all. */
    dayLabel?: string;
    phase: CropPhase;
    water?: WaterState;
}

const dayLabelOf = (phase: CropPhase, day: number | null, hasPlot: boolean): string | undefined => {
    if (!hasPlot) return undefined;
    if (phase === 'CROP_CYCLE') return day == null ? undefined : `दिवस ${day}`;
    return day == null ? 'जमीन तयारी' : `जमीन तयारी · दिवस ${day}`;
};

/** When a log was saved (ms); unknown times go last. */
const savedAt = (log: DailyLog): number => {
    const ms = Date.parse(log.meta?.createdAtISO ?? '');
    return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
};

/** The day's non-deleted logs that pass `inView`, morning first: the SAME set the day view shows (review B006). */
export const placeDayLogs = (history: readonly DailyLog[], dateKey: string, inView: (log: DailyLog) => boolean): DailyLog[] =>
    dayLogsOf(history, dateKey).filter(inView).sort((a, b) => savedAt(a) - savedAt(b));

export const plotDayLogs = (history: readonly DailyLog[], ref: PlotRef, dateKey: string): DailyLog[] =>
    placeDayLogs(history, dateKey, plotLogFilter(ref));

/** The chips name nobody: who spoke is the day view's business. */
const NO_WHO: WhoDeps = { youIds: new Set(), nameOf: () => undefined, youLabel: '', unknownLabel: '' };
/** Parts whose names are joined across recordings: names, never amounts. */
const NAMES_ONLY: ReadonlySet<PartKey> = new Set(['crop']);
/** Each entry its own chip (a note is a sentence of its own). */
const ONE_EACH: ReadonlySet<PartKey> = new Set(['observation']);

/**
 * Everything that happened, as chips, in the result screen's part order (stoppages last). One chip per part per
 * recording — never a number added across recordings (P4); the record's money is not a chip (the ledger's is).
 */
export function dayChipsOf(logs: readonly DailyLog[], language?: string | null): DayChip[] {
    const byPart = new Map<PartKey, DayChip[]>(PARTS.map(p => [p.key, []]));
    const blockers: DayChip[] = [];
    const names = new Map<string, DayChip>(); // `${part}|${verified}` → the one shared chip
    for (const group of groupByRecording(logs)) {
        const view = withoutInventedStoppage(recordingOf(group, NO_WHO), group);
        const key = recordingKeyOf(view.log);
        const perPart = new Map<PartKey, PartEntry[]>();
        for (const e of view.entries) {
            if (e.part === 'expense') continue; // money: the ledger's, on its own chip
            perPart.set(e.part, [...(perPart.get(e.part) ?? []), e]);
        }
        for (const [part, entries] of perPart) {
            if (NAMES_ONLY.has(part)) {
                for (const e of entries) {
                    const id = `${part}|${e.verified ? 'yes' : 'no'}`;
                    const chip = names.get(id) ?? { id: `chip:${id}`, kind: part, text: '', verified: e.verified };
                    const text = entryText(e, language);
                    const have = chip.text ? chip.text.split(' · ') : [];
                    if (text && !have.includes(text)) chip.text = [...have, text].join(' · ');
                    if (!names.has(id)) { names.set(id, chip); byPart.get(part)!.push(chip); }
                }
                continue;
            }
            if (ONE_EACH.has(part)) {
                entries.forEach(e => byPart.get(part)!.push({ id: `chip:${e.id}`, kind: part, text: entryText(e, language), verified: e.verified, recordingKey: key }));
                continue;
            }
            // One recording, one chip: its own values side by side, never added up. Unsure items get their own chip.
            for (const verified of [true, false]) {
                const mine = entries.filter(e => e.verified === verified);
                if (mine.length === 0) continue;
                const texts = [...new Set(mine.map(e => entryText(e, language)).filter(Boolean))];
                byPart.get(part)!.push({ id: `chip:${key}:${part}:${verified ? 'yes' : 'no'}`, kind: part, text: texts.join(' · '), verified, recordingKey: key });
            }
        }
        view.blockers.forEach(b => blockers.push({ id: `chip:${b.id}`, kind: 'blocker', text: b.value ?? b.quote ?? '', verified: b.verified, recordingKey: key }));
    }
    return [...PARTS.flatMap(p => byPart.get(p.key) ?? []), ...blockers];
}

/** The card facts every place shares: status, chips, money, trust, how many times told. */
export function buildDayCardCore(logs: readonly DailyLog[], money?: MoneyFigure, language?: string | null): DayCardCore {
    const statuses = logs.map(l => getDayStatus(l));
    // Worked when any recording of the day says work was done; stopped only when none did and one says it stopped.
    const status: DayCardCore['status'] = statuses.includes('worked') ? 'worked' : statuses.includes('blocked') ? 'blocked' : 'empty';
    const stopper = logs.find(l => l.disturbance?.scope === 'FULL_DAY');
    return {
        log: logs[0],
        status,
        stoppedReason: status === 'blocked' ? stopper?.disturbance?.reason : undefined,
        chips: dayChipsOf(logs, language),
        ...(money && money.amount !== null && !money.hidden ? { money } : {}),
        ...(logs.length > 0 ? { confirmed: logs.every(isConfirmed) } : {}),
        recordings: groupByRecording(logs).length,
    };
}

export function buildPlotDayCard(ref: PlotRef, history: readonly DailyLog[], _scope: ViewScope, dateKey: string, date: Date, money?: MoneyFigure, language?: string | null): PlotDayCard {
    const logs = plotDayLogs(history, ref, dateKey);
    const timelinePlot = ref.plot ?? ref.crop.plots?.[0];
    const timeline = getPhaseAndDay(timelinePlot, date);
    const water = getIrrigationStatus(date, ref.plot, logs.find(l => (l.irrigation ?? []).length > 0) ?? logs[0]);
    const baseline = ref.plot?.baseline;
    const weatherLog = logs.find(l => l.weatherSnapshot);
    return {
        ref,
        ...buildDayCardCore(logs, money, language),
        weather: weatherLog?.weatherSnapshot
            ? { temp: formatTemperature(weatherLog.weatherSnapshot.current.tempC), condition: weatherLog.weatherSnapshot.current.conditionText }
            : undefined,
        area: baseline?.totalArea ? `${baseline.totalArea} ${AREA_UNIT[baseline.unit] ?? baseline.unit}` : undefined,
        dayLabel: dayLabelOf(timeline.phase, timeline.day, !!timelinePlot),
        phase: timeline.phase,
        water: water === 'ON_TRACK' || water === 'MISSED' || water === 'EXTRA' ? water : undefined,
    };
}
