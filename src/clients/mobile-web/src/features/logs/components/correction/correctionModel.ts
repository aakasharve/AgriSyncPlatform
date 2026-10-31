/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane E1) — "बदला" by speaking (the founder's screen 4). Pure.
 *
 * THE MERGE RULE (orchestrator's call, kept simple and visible):
 *   - what he says is read as a NORMAL utterance in that entry's crop / plot (the same factory a recording's words go
 *     through, `LogFactory.createFromVoiceResult`, with the entry's own plot as the scope; the whole farm for an entry
 *     with no plot, which the factory cannot place otherwise);
 *   - every bucket present in that reading REPLACES the same bucket of the entry; a bucket he did not mention stays
 *     exactly as it was;
 *   - nothing is written here — the screen shows before → after, and only "जतन करा" saves (a new content version
 *     through lane F1's `revise_log_content`; the server keeps every version, P3);
 *   - KNOWN LIMIT (reported, not fixed): "पण / also" ("पाच बायका पण होत्या") replaces the whole bucket, it does not add.
 *
 * Fix pass (review B001, B003, B010):
 *   - LABOUR goes only to the engagement it is about, matched by IDENTITY (engagement type + group: male / female /
 *     mixed / not said), never by position. Each said row must match exactly one engagement, one-to-one, and state a
 *     number (never a count inferred from names — "बाळू नव्हता, गणेश होता" says no number); only the four numbers a
 *     labour correction can carry change (count, men, women, hours). Anything else — ambiguous, a new engagement, names
 *     only, a wage — changes NO labour here (`labourNotChanged`): worker changes for that entry are made in हजेरी;
 *   - NOTES change by TYPE: a stoppage note, an observation and a reminder / planned work are three things; saying one
 *     replaces only that type, and the others stay. Planned work and its reminder notes move together;
 *   - WATER said as NOT given is the stoppage he said (the water row with its reason), never silently nothing.
 *
 * Before → after is shown the result screen's way (`partEntriesOf`): a part is "changed" when what it says differs.
 */
import { LogVerificationStatus, type AgriLogResponse, type CropProfile, type DailyLog, type FarmerProfile, type LabourEvent, type LogScope, type ObservationNote } from '../../../../types';
import { isCompletedIrrigationEvent } from '../../services/irrigationCompletion';
import { LogFactory } from '../../../../core/domain/LogFactory';
import { systemClock, type Clock } from '../../../../core/domain/services/Clock';
import { idGenerator, type IdGenerator } from '../../../../core/domain/services/IdGenerator';
import { entryText } from '../voiceResult/partNames';
import { PARTS, blockersOf, isConfirmed, partEntriesOf, type BlockerEntry, type PartEntry, type PartKey } from '../voiceResult/resultModel';

/** The buckets a spoken change can replace — the ones the content document and the labour route carry. */
export const CORRECTABLE_BUCKETS = ['cropActivities', 'irrigation', 'labour', 'inputs', 'machinery', 'activityExpenses', 'observations', 'plannedTasks'] as const;
export type CorrectableBucket = typeof CORRECTABLE_BUCKETS[number];

const FARM_GLOBAL = 'FARM_GLOBAL';
/** A note's type for the merge: a stoppage, a reminder (planned work), or an observation (anything else he noted). */
type NoteKind = 'issue' | 'reminder' | 'observation';
const noteKind = (o: ObservationNote): NoteKind => (o.noteType === 'issue' ? 'issue' : o.noteType === 'reminder' ? 'reminder' : 'observation');

/**
 * The entry's own crop and plot, as the recorder's scope. The whole farm for a farm-wide entry, and for an entry with
 * no plot (a crop-level record): the recorder and the factory work on a plot or the whole farm only (review B006).
 */
export function scopeOfLog(log: DailyLog): LogScope {
    const sel = log.context?.selection?.[0];
    const plotId = sel?.selectedPlotIds?.[0];
    if (!sel || sel.cropId === FARM_GLOBAL || !plotId) return { selectedCropIds: [FARM_GLOBAL], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' };
    return { selectedCropIds: [sel.cropId], selectedPlotIds: [plotId], mode: 'single', applyPolicy: 'broadcast' };
}

/** Did he say anything a bucket can be changed with? (Nothing understood = nothing to show, nothing to save.) */
export function saysAnything(draft: AgriLogResponse): boolean {
    return CORRECTABLE_BUCKETS.some(b => ((draft[b as keyof AgriLogResponse] as unknown[] | undefined)?.length ?? 0) > 0) || !!draft.disturbance;
}

export interface SpokenDeps {
    crops: CropProfile[];
    profile: FarmerProfile;
    clock?: Clock;
    idGen?: IdGenerator;
}

/** His words read as a normal utterance in the entry's crop / plot: the log they would make there (never saved). */
export function spokenAsLog(draft: AgriLogResponse, log: DailyLog, deps: SpokenDeps): DailyLog | undefined {
    const scope = scopeOfLog(log);
    const logs = LogFactory.createFromVoiceResult(draft, scope, deps.crops, deps.profile, undefined, undefined, deps.clock ?? systemClock, deps.idGen ?? idGenerator, false);
    const plotId = scope.selectedPlotIds[0];
    return logs.find(l => !plotId || (l.context?.selection ?? []).some(s => (s.selectedPlotIds ?? []).includes(plotId))) ?? logs[0];
}

export interface CorrectionMerge {
    /** The buckets that change (only these are sent); a bucket he did not mention is absent. */
    updates: Partial<DailyLog>;
    /** Which buckets his words changed. */
    replaced: CorrectableBucket[];
    /** The entry as it would read after "जतन करा". */
    after: DailyLog;
    /** He spoke about workers, but not as a change this screen can make (see `correctLabour`): labour stays as it was. */
    labourNotChanged: boolean;
}

const said = (draft: AgriLogResponse, bucket: CorrectableBucket): boolean =>
    ((draft[bucket as keyof AgriLogResponse] as unknown[] | undefined)?.length ?? 0) > 0;

/** Every item keeps an id (the record's rows are keyed by it). */
const withIds = <T extends { id?: string }>(rows: readonly T[], idGen: IdGenerator): T[] => rows.map(r => (r.id ? r : { ...r, id: idGen.generate() }));

const positive = (n: number | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
/** The engagement's kind, in the newer field's words (the older `type` maps onto it). */
const kindOf = (e: LabourEvent): string => e.engagementType ?? (e.type === 'CONTRACT' ? 'contract_piece' : e.type === 'SELF' ? 'self' : 'hired_daily');
/** The engagement's group: as recorded, else as its own numbers say; "not said" when they say nothing. */
const groupOf = (e: LabourEvent): string => {
    if (e.gender && e.gender !== 'unknown') return e.gender;
    if (positive(e.maleCount) && positive(e.femaleCount)) return 'mixed';
    if (positive(e.femaleCount)) return 'female';
    if (positive(e.maleCount)) return 'male';
    return 'unsaid';
};
const identityOf = (e: LabourEvent): string => `${kindOf(e)}|${groupOf(e)}`;
/** The numbers a labour correction can carry (`buildLabourCorrections`): nothing else of a row travels. */
const statesNumber = (e: LabourEvent): boolean => positive(e.count) || positive(e.maleCount) || positive(e.femaleCount) || positive(e.durationHours);
/** Money or names said on a row: no labour correction can carry them. */
const saysMoreThanNumbers = (e: LabourEvent): boolean =>
    positive(e.totalCost) || positive(e.wagePerPerson) || positive(e.rate) || (e.workerNames ?? []).length > 0;

/**
 * Review B001 — his labour words as corrections of the engagements they are ABOUT, matched by identity, one-to-one.
 * `null` when they cannot be (ambiguous, a new engagement, names only, money or names said): then no labour changes.
 */
export function correctLabour(old: readonly LabourEvent[], spoken: readonly LabourEvent[]): LabourEvent[] | null {
    if (spoken.length === 0 || spoken.some(r => !statesNumber(r) || saysMoreThanNumbers(r))) return null;
    const out = [...old];
    const used = new Set<number>();
    for (const r of spoken) {
        const matches = old.map((o, i) => ({ o, i })).filter(({ o }) => identityOf(o) === identityOf(r));
        if (matches.length !== 1 || used.has(matches[0].i)) return null;
        const { o, i } = matches[0];
        used.add(i);
        out[i] = {
            ...o,
            ...(positive(r.count) && { count: r.count }),
            ...(positive(r.maleCount) && { maleCount: r.maleCount }),
            ...(positive(r.femaleCount) && { femaleCount: r.femaleCount }),
            ...(positive(r.durationHours) && { durationHours: r.durationHours }),
        };
    }
    return out;
}

export function mergeCorrection(log: DailyLog, draft: AgriLogResponse, fresh: DailyLog, idGen: IdGenerator = idGenerator): CorrectionMerge {
    const updates: Partial<DailyLog> = {};
    const replaced: CorrectableBucket[] = [];
    for (const bucket of ['cropActivities', 'inputs', 'machinery', 'activityExpenses'] as const) {
        if (!said(draft, bucket)) continue;
        replaced.push(bucket);
        (updates as Record<string, unknown>)[bucket] = withIds((fresh[bucket] ?? []) as Array<{ id?: string }>, idGen);
    }
    // Water: what was given, and — review B010 — water he said was NOT given, kept as the stoppage he said.
    if (said(draft, 'irrigation')) {
        replaced.push('irrigation');
        const notGiven = (draft.irrigation ?? []).filter(e => e.role !== 'spray-carrier' && !isCompletedIrrigationEvent(e));
        updates.irrigation = withIds([...(fresh.irrigation ?? []), ...notGiven], idGen);
    }
    // Labour (review B001): only the engagements his words are about, by identity; else nothing.
    let labourNotChanged = false;
    if (said(draft, 'labour')) {
        const corrected = correctLabour(log.labour ?? [], draft.labour ?? []);
        if (corrected) { updates.labour = corrected; replaced.push('labour'); } else labourNotChanged = true;
    }
    // Notes by TYPE (review B003); planned work and its reminder notes move together.
    const freshNotes = fresh.observations ?? [];
    const kinds = new Set<NoteKind>(freshNotes.map(noteKind));
    if (said(draft, 'plannedTasks') || kinds.has('reminder')) {
        kinds.add('reminder');
        updates.plannedTasks = withIds(fresh.plannedTasks ?? [], idGen);
        replaced.push('plannedTasks');
    }
    if (kinds.size > 0) {
        updates.observations = [
            ...(log.observations ?? []).filter(o => !kinds.has(noteKind(o))),
            ...withIds(freshNotes.filter(o => kinds.has(noteKind(o))), idGen),
        ];
        replaced.push('observations');
    }
    if (draft.disturbance) updates.disturbance = fresh.disturbance ?? draft.disturbance;
    return { updates, replaced, after: { ...log, ...updates }, labourNotChanged };
}

/**
 * What "जतन करा" writes: the changed buckets, and — when the entry was confirmed — its new version's true status. A
 * confirmation applies to the version it was given for (lanes F1 / L6): the new version is not confirmed until someone
 * confirms IT.
 */
export function revisionUpdates(log: DailyLog, merge: CorrectionMerge): Partial<DailyLog> {
    return {
        ...merge.updates,
        ...(isConfirmed(log) ? { verification: { status: LogVerificationStatus.DRAFT, required: true } } : {}),
    };
}

export interface CorrectionRow {
    part: PartKey;
    before: PartEntry[];
    after: PartEntry[];
    /** What the part says is different after his words. */
    changed: boolean;
}

/** Shown in place of money the person holding this phone may not see (the same mark as आढावा). */
export const HIDDEN_MONEY = '—';

const valuesKey = (entries: readonly PartEntry[], language: string | null | undefined): string =>
    JSON.stringify(entries.map(e => [entryText(e, language), e.verified]));
const masked = (entries: PartEntry[], hideMoney: boolean): PartEntry[] =>
    (hideMoney ? entries.map(e => (e.part === 'expense' ? { ...e, value: HIDDEN_MONEY, quote: undefined } : e)) : entries);

/** The entry part by part, before and after, in the result screen's order; only parts that say something. */
export function correctionRows(before: DailyLog, after: DailyLog, opts: { hideMoney?: boolean; language?: string | null } = {}): CorrectionRow[] {
    const b = masked(partEntriesOf(before, opts.language), !!opts.hideMoney);
    const a = masked(partEntriesOf(after, opts.language), !!opts.hideMoney);
    return PARTS.map(m => {
        const was = b.filter(e => e.part === m.key);
        const now = a.filter(e => e.part === m.key);
        return { part: m.key, before: was, after: now, changed: valuesKey(was, opts.language) !== valuesKey(now, opts.language) };
    }).filter(r => r.before.length > 0 || r.after.length > 0);
}

/** The entry's stoppages, before and after, and those his words removed (shown struck through, review B003). */
export function blockerChange(before: DailyLog, after: DailyLog, language?: string | null): { before: BlockerEntry[]; after: BlockerEntry[]; gone: BlockerEntry[]; changed: boolean } {
    const was = blockersOf(before, language);
    const now = blockersOf(after, language);
    const key = (xs: BlockerEntry[]) => JSON.stringify(xs.map(x => x.value));
    const kept = new Set(now.map(x => x.value));
    return { before: was, after: now, gone: was.filter(x => !kept.has(x.value)), changed: key(was) !== key(now) };
}

/** A before value that is gone after his words: shown struck through on a changed part. */
export const goneValues = (row: CorrectionRow, language?: string | null): string[] => {
    const kept = new Set(row.after.map(e => entryText(e, language)));
    return row.before.map(e => entryText(e, language)).filter(v => v && !kept.has(v));
};

/** A record the हजेरी door saved holds labour only (B002): its details are refused on the server (lane F1), so here too. */
export const isLabourDoorLog = (log: DailyLog): boolean => log.captureScope === 'labour';
