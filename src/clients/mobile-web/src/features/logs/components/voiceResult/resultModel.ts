/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13; inventory LP-09..LP-15, LP-21, LP-24)
 *
 * The ONE result screen's view model, built from REAL logs (never the preview's sample day). Pure.
 *
 * Rules it keeps (founder PLR-D1 rounds 2-5, doctrine P4):
 *   - EIGHT parts of a day. A part he did not mention is listed as "not mentioned" — never as a 0.
 *   - A value is shown only as it was recorded: no count, hour or rupee is computed, nothing is summed.
 *   - His words are colour-marked ONLY with a phrase that is VERIFIED: the item's `sourceText`, not flagged
 *     unverified by the server (`provenanceVerified !== false`), and found word-for-word in his transcript.
 *     An item without such a phrase is shown without a quote; no phrase is ever made up.
 *   - The screen is the plot's WHOLE DAY: the recording just made, and the day's earlier ones newest first.
 */
import { LogVerificationStatus, type DailyLog } from '../../../../types';
import { resolveLabourHeadcount } from '../../../../domain/logs/labourHeadcount';
import { formatFarmerTime } from '../../../../shared/utils/displayTime';
import { buildNodes, dayCategoryStates, type CategoryId, type IconName, type RingNodeData } from '../shramsathi/understandingRing';

export type PartKey = 'crop' | 'labour' | 'irrigation' | 'inputs' | 'expense' | 'machinery' | 'observation' | 'planned';

export interface PartMeta {
    key: PartKey;
    label: string;
    /** Tint of the part's row and of its phrases in his words. */
    tint: string;
    /** The ring's own icon for this part: one picture for "water" everywhere. */
    icon: IconName;
}

// PROPOSED (Marathi) — the part names of the founder-approved design preview (postVoiceResult/model.ts), not yet reviewed.
export const PARTS: readonly PartMeta[] = [
    { key: 'crop', label: 'पीक काम', tint: '#dcfce7', icon: 'work' },
    { key: 'labour', label: 'मजूर', tint: '#fef3c7', icon: 'labour' },
    { key: 'irrigation', label: 'पाणी', tint: '#cffafe', icon: 'water' },
    { key: 'inputs', label: 'औषध / खत', tint: '#ede9fe', icon: 'inputs' },
    { key: 'expense', label: 'खर्च', tint: '#e0f2fe', icon: 'expenses' },
    { key: 'machinery', label: 'यंत्र', tint: '#fee2e2', icon: 'machinery' },
    { key: 'observation', label: 'निरीक्षण', tint: '#fce7f3', icon: 'observations' },
    { key: 'planned', label: 'उद्याचं काम', tint: '#ffedd5', icon: 'reminders' },
];

export const partMeta = (key: PartKey): PartMeta => PARTS.find(p => p.key === key) ?? PARTS[0];

/** One thing Sathi understood, tied to the log (recording) it came from. */
export interface PartEntry {
    id: string;
    logId: string;
    part: PartKey;
    /** What was noted, as recorded. `null` = the part was mentioned with nothing more to show. */
    value: string | null;
    /** His own verified phrase for it, if any. */
    quote?: string;
}

interface Sourced { sourceText?: string; provenanceVerified?: boolean }

/** The item's phrase, ONLY when it is verified and appears word-for-word in his transcript. */
export function verifiedPhrase(item: Sourced, transcript: string | undefined): string | undefined {
    const phrase = item.sourceText?.trim();
    if (!phrase || item.provenanceVerified === false || !transcript) return undefined;
    return transcript.includes(phrase) ? phrase : undefined;
}

const LATIN = /[A-Za-z]/;
const clean = (s?: string | null): string => (s ?? '').trim();
/** A number exactly as recorded (no rounding up into something he did not say). */
const asRecorded = (n: number): string => String(n);
/**
 * A free-text label the PARSER wrote (an activity title, a reason). Kept when it is Marathi; when it is
 * English and his own verified phrase exists, his phrase is shown instead (no English on his screen).
 */
const parserText = (text: string | undefined, quote: string | undefined): string => {
    const t = clean(text);
    return t && LATIN.test(t) && quote ? '' : t;
};

// PROPOSED (Marathi) — machine names for the parser's machine types.
const MACHINE: Partial<Record<string, string>> = {
    tractor: 'ट्रॅक्टर', tiller: 'टिलर', harvester: 'हार्वेस्टर', drone: 'ड्रोन', sprayer: 'फवारणी यंत्र',
};

const join = (...parts: Array<string | null | undefined>): string => parts.map(clean).filter(Boolean).join(' · ');

/** Everything understood from ONE log, part by part, in the parts' order. */
export function partEntriesOf(log: DailyLog): PartEntry[] {
    const transcript = log.fullTranscript;
    const out: PartEntry[] = [];
    const add = (part: PartKey, index: number, item: Sourced & { id?: string }, valueOf: (quote?: string) => string) => {
        const quote = verifiedPhrase(item, transcript);
        const value = valueOf(quote);
        out.push({ id: item.id || `${log.id}:${part}:${index}`, logId: log.id, part, value: value || quote || null, quote });
    };

    (log.cropActivities ?? []).forEach((a, i) => add('crop', i, a, q => parserText(a.workTypes?.filter(Boolean).join(', ') || a.title, q)));
    (log.labour ?? []).forEach((e, i) => add('labour', i, e, q => {
        const n = resolveLabourHeadcount(e);
        return n != null ? `${asRecorded(n)} जण` : parserText(e.activity, q);
    }));
    (log.irrigation ?? []).forEach((e, i) => add('irrigation', i, e, () => join(
        (e.durationHours ?? 0) > 0 ? `${asRecorded(e.durationHours as number)} तास` : '',
        (e.waterVolumeLitres ?? 0) > 0 ? `${asRecorded(e.waterVolumeLitres as number)} लिटर` : '',
    )));
    (log.inputs ?? []).forEach((e, i) => add('inputs', i, e, () => {
        const names = (e.mix ?? []).map(m => clean(m.productName)).filter(Boolean);
        return names.length > 0 ? names.join(', ') : clean(e.productName);
    }));
    (log.activityExpenses ?? []).forEach((e, i) => add('expense', i, e, q => join(
        parserText(e.reason, q),
        typeof e.totalAmount === 'number' ? `₹${asRecorded(e.totalAmount)}` : '',
    )));
    (log.machinery ?? []).forEach((e, i) => add('machinery', i, e, () => join(
        MACHINE[e.type],
        (e.hoursUsed ?? 0) > 0 ? `${asRecorded(e.hoursUsed as number)} तास` : '',
    )));
    (log.observations ?? []).forEach((o, i) => add(o.noteType === 'reminder' ? 'planned' : 'observation', i, o, () => clean(o.textRaw)));
    (log.plannedTasks ?? []).forEach((t, i) => add('planned', i, t, q => parserText(t.title, q)));

    const order = new Map(PARTS.map((p, i) => [p.key, i]));
    return out.sort((a, b) => (order.get(a.part) ?? 0) - (order.get(b.part) ?? 0));
}

/** "He confirmed it": the same rule the rest of the app uses for a verified log. */
export const isConfirmed = (log: DailyLog): boolean =>
    log.verification?.status === LogVerificationStatus.VERIFIED || log.verification?.status === LogVerificationStatus.APPROVED;

export interface Who { name: string; you: boolean }

export interface WhoDeps {
    /** Ids that mean "the person holding this phone" (the active operator and the signed-in user). */
    youIds: ReadonlySet<string>;
    nameOf: (operatorId: string) => string | undefined;
    /** Shown for the phone holder. */
    youLabel: string;
    /** Shown when nobody was recorded as speaking it (never a guessed name). */
    unknownLabel: string;
}

export const whoSpoke = (log: DailyLog, deps: WhoDeps): Who => {
    const id = log.meta?.createdByOperatorId ?? '';
    if (id && deps.youIds.has(id)) return { name: deps.youLabel, you: true };
    return { name: (id && deps.nameOf(id)) || deps.unknownLabel, you: false };
};

/** One recording of the day. */
export interface RecordingView {
    log: DailyLog;
    id: string;
    timeLabel: string;
    who: Who;
    confirmed: boolean;
    transcript: string;
    entries: PartEntry[];
}

export const recordingOf = (log: DailyLog, deps: WhoDeps): RecordingView => ({
    log,
    id: log.id,
    timeLabel: formatFarmerTime(log.meta?.createdAtISO),
    who: whoSpoke(log, deps),
    confirmed: isConfirmed(log),
    transcript: clean(log.fullTranscript),
    entries: partEntriesOf(log),
});

const plotIdsOf = (logs: readonly DailyLog[]): Set<string> =>
    new Set(logs.flatMap(l => l.context?.selection?.flatMap(s => s.selectedPlotIds ?? []) ?? []));

/**
 * The plot's day: every log of the same day that touches one of the plots of `current` (or, for a record
 * of the whole farm, the other whole-farm records of that day). Deleted logs never count.
 */
export function sameDayLogs(current: readonly DailyLog[], history: readonly DailyLog[]): DailyLog[] {
    const date = current[0]?.date;
    if (!date) return [];
    const plots = plotIdsOf(current);
    return history.filter(l => {
        if (l.date !== date || l.deletion) return false;
        const its = plotIdsOf([l]);
        return plots.size === 0 ? its.size === 0 : [...its].some(p => plots.has(p));
    });
}

const createdMs = (log: DailyLog): number => {
    const ms = Date.parse(log.meta?.createdAtISO ?? '');
    return Number.isFinite(ms) ? ms : 0;
};

export interface Speaker { name: string; you: boolean; times: number }

export interface DayView {
    /** The recording he just made (one log per plot when he named several). */
    current: RecordingView[];
    /** Today's earlier recordings for the same plot(s), NEWEST FIRST. */
    earlier: RecordingView[];
    /** Every part, in order, with what the whole day says about it. */
    byPart: Record<PartKey, PartEntry[]>;
    /** Parts the day says nothing about: shown in red as "not mentioned", never as 0. */
    missing: PartKey[];
    /** Parts the recording just made added to. */
    touchedNow: Set<PartKey>;
    speakers: Speaker[];
}

export function buildDayView(current: readonly DailyLog[], history: readonly DailyLog[], deps: WhoDeps): DayView {
    const currentIds = new Set(current.map(l => l.id));
    const earlierLogs = sameDayLogs(current, history)
        .filter(l => !currentIds.has(l.id))
        .sort((a, b) => createdMs(b) - createdMs(a));
    const now = current.map(l => recordingOf(l, deps));
    const earlier = earlierLogs.map(l => recordingOf(l, deps));

    const byPart = Object.fromEntries(PARTS.map(p => [p.key, [] as PartEntry[]])) as Record<PartKey, PartEntry[]>;
    for (const r of [...now, ...earlier]) for (const e of r.entries) byPart[e.part].push(e);

    const speakers: Speaker[] = [];
    for (const r of [...[...earlier].reverse(), ...now]) {
        const hit = speakers.find(s => s.name === r.who.name && s.you === r.who.you);
        if (hit) hit.times += 1; else speakers.push({ ...r.who, times: 1 });
    }

    return {
        current: now,
        earlier,
        byPart,
        missing: PARTS.filter(p => byPart[p.key].length === 0).map(p => p.key),
        touchedNow: new Set(now.flatMap(r => r.entries.map(e => e.part))),
        speakers,
    };
}

/** A run of his words; `part` set when the run is a verified phrase that made Sathi understand that part. */
export interface WordRun { text: string; part?: PartKey }

/** His transcript cut into runs, each verified phrase marked with its part. Overlapping phrases keep the first. */
export function markTranscript(transcript: string, entries: readonly PartEntry[]): WordRun[] {
    if (!transcript) return [];
    const ranges: Array<{ start: number; end: number; part: PartKey }> = [];
    for (const e of entries) {
        if (!e.quote) continue;
        for (let from = 0, at = transcript.indexOf(e.quote); at >= 0; from = at + 1, at = transcript.indexOf(e.quote, from)) {
            const end = at + e.quote.length;
            if (!ranges.some(r => at < r.end && end > r.start)) { ranges.push({ start: at, end, part: e.part }); break; }
        }
    }
    ranges.sort((a, b) => a.start - b.start);
    const runs: WordRun[] = [];
    let cursor = 0;
    for (const r of ranges) {
        if (r.start > cursor) runs.push({ text: transcript.slice(cursor, r.start) });
        runs.push({ text: transcript.slice(r.start, r.end), part: r.part });
        cursor = r.end;
    }
    if (cursor < transcript.length) runs.push({ text: transcript.slice(cursor) });
    return runs;
}

/** The parts his words were marked with, in the order he first said them, each with its phrases. */
export function phrasesByPart(runs: readonly WordRun[]): Array<{ part: PartKey; phrases: string[] }> {
    const out: Array<{ part: PartKey; phrases: string[] }> = [];
    for (const r of runs) {
        if (!r.part) continue;
        const hit = out.find(o => o.part === r.part);
        if (hit) hit.phrases.push(r.text.trim()); else out.push({ part: r.part, phrases: [r.text.trim()] });
    }
    return out;
}

/**
 * The ring's orbs for the plot's day, by the ring's own coverage rules. Founder 2026-10-25: nothing on the
 * ring stays grey — a part that was not told shows as the red X (an invitation, never a 0).
 */
export function ringNodesForDay(logs: readonly DailyLog[], date: string | undefined): RingNodeData[] {
    return buildNodes(dayCategoryStates(logs, date)).map(n => (n.state === 'neutral' ? { ...n, state: 'missed' as const } : n));
}

/** Which part a ring orb belongs to, so tapping a red orb opens the mic to tell it. */
export const PART_OF_NODE: Partial<Record<CategoryId, PartKey>> = {
    work: 'crop', labour: 'labour', inputs: 'inputs', water: 'irrigation', machinery: 'machinery',
    cropNote: 'observation', expenses: 'expense', observations: 'observation', reminders: 'planned',
};
