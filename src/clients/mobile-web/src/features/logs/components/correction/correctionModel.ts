/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane E1) — "बदला" by speaking (the founder's screen 4). Pure.
 *
 * THE MERGE RULE (orchestrator's call, kept simple and visible):
 *   - what he says is read as a NORMAL utterance in that entry's crop / plot (the same factory a recording's words go
 *     through, `LogFactory.createFromVoiceResult`, with the entry's own plot as the scope);
 *   - every bucket present in that reading REPLACES the same bucket of the entry; a bucket he did not mention stays
 *     exactly as it was;
 *   - nothing is written here — the screen shows before → after, and only "जतन करा" saves (a new content version
 *     through lane F1's `revise_log_content`; the server keeps every version, P3);
 *   - KNOWN LIMIT (reported, not fixed): "पण / also" ("पाच बायका पण होत्या") replaces the whole bucket, it does not add.
 *
 * Two record-keeping details, so a replaced bucket still reaches the server the way the old form's edit did:
 *   - labour: when the new reading has as many labour rows as the entry, each keeps its engagement's identity
 *     (`labourAssignmentId`) by position, so the change travels as a labour correction; a different number of rows
 *     changes WHICH engagements the day has, which no route can send — the save says so (`buildEditSavedMessage`);
 *   - planned work: a replaced `plannedTasks` brings its mirrored reminder notes with it, and the old mirrors go.
 *
 * Before → after is shown the result screen's way (`partEntriesOf`): a part is "changed" when what it says differs.
 */
import { LogVerificationStatus, type AgriLogResponse, type CropProfile, type DailyLog, type FarmerProfile, type LogScope, type ObservationNote } from '../../../../types';
import { LogFactory } from '../../../../core/domain/LogFactory';
import { systemClock, type Clock } from '../../../../core/domain/services/Clock';
import { idGenerator, type IdGenerator } from '../../../../core/domain/services/IdGenerator';
import { entryText } from '../voiceResult/partNames';
import { PARTS, blockersOf, isConfirmed, partEntriesOf, type BlockerEntry, type PartEntry, type PartKey } from '../voiceResult/resultModel';

/** The buckets a spoken change can replace — the ones the content document and the labour route carry. */
export const CORRECTABLE_BUCKETS = ['cropActivities', 'irrigation', 'labour', 'inputs', 'machinery', 'activityExpenses', 'observations', 'plannedTasks'] as const;
export type CorrectableBucket = typeof CORRECTABLE_BUCKETS[number];

const FARM_GLOBAL = 'FARM_GLOBAL';
/** The tags `LogFactory` puts on a reminder note it mirrors from a planned task. */
const MIRROR_TAGS = new Set(['planned_task', 'manual_task']);
const isMirror = (o: ObservationNote): boolean => o.noteType === 'reminder' && (o.tags ?? []).some(t => MIRROR_TAGS.has(t));

/** The entry's own crop and plot, as the recorder's scope (the whole farm for a farm-wide entry). */
export function scopeOfLog(log: DailyLog): LogScope {
    const sel = log.context?.selection?.[0];
    if (!sel || sel.cropId === FARM_GLOBAL) return { selectedCropIds: [FARM_GLOBAL], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' };
    return { selectedCropIds: [sel.cropId], selectedPlotIds: (sel.selectedPlotIds ?? []).slice(0, 1), mode: 'single', applyPolicy: 'broadcast' };
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
    /** Which buckets his words replaced. */
    replaced: CorrectableBucket[];
    /** The entry as it would read after "जतन करा". */
    after: DailyLog;
}

const said = (draft: AgriLogResponse, bucket: CorrectableBucket): boolean =>
    ((draft[bucket as keyof AgriLogResponse] as unknown[] | undefined)?.length ?? 0) > 0;

/** Every item keeps an id (the record's rows are keyed by it). */
const withIds = <T extends { id?: string }>(rows: readonly T[], idGen: IdGenerator): T[] => rows.map(r => (r.id ? r : { ...r, id: idGen.generate() }));

export function mergeCorrection(log: DailyLog, draft: AgriLogResponse, fresh: DailyLog, idGen: IdGenerator = idGenerator): CorrectionMerge {
    const updates: Partial<DailyLog> = {};
    const replaced: CorrectableBucket[] = [];
    for (const bucket of CORRECTABLE_BUCKETS) {
        if (!said(draft, bucket)) continue;
        replaced.push(bucket);
        (updates as Record<string, unknown>)[bucket] = withIds((fresh[bucket] ?? []) as Array<{ id?: string }>, idGen);
    }
    // Labour: the same number of rows keeps each engagement's identity, so the change is a correction the server takes.
    if (updates.labour && (log.labour ?? []).length === updates.labour.length) {
        const old = log.labour ?? [];
        updates.labour = updates.labour.map((row, i) => ({
            ...row,
            id: old[i].id,
            ...(old[i].labourAssignmentId ? { labourAssignmentId: old[i].labourAssignmentId } : {}),
        }));
    }
    // Planned work brings its mirrored reminder notes; the old mirrors go with the old plans.
    if (updates.plannedTasks && !updates.observations) {
        updates.observations = [
            ...(log.observations ?? []).filter(o => !isMirror(o)),
            ...(fresh.observations ?? []).filter(isMirror),
        ];
    }
    if (draft.disturbance) updates.disturbance = fresh.disturbance ?? draft.disturbance;
    return { updates, replaced, after: { ...log, ...updates } };
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
    const b = masked(partEntriesOf(before), !!opts.hideMoney);
    const a = masked(partEntriesOf(after), !!opts.hideMoney);
    return PARTS.map(m => {
        const was = b.filter(e => e.part === m.key);
        const now = a.filter(e => e.part === m.key);
        return { part: m.key, before: was, after: now, changed: valuesKey(was, opts.language) !== valuesKey(now, opts.language) };
    }).filter(r => r.before.length > 0 || r.after.length > 0);
}

/** The entry's stoppages, before and after. */
export function blockerChange(before: DailyLog, after: DailyLog): { before: BlockerEntry[]; after: BlockerEntry[]; changed: boolean } {
    const was = blockersOf(before);
    const now = blockersOf(after);
    const key = (xs: BlockerEntry[]) => JSON.stringify(xs.map(x => x.value));
    return { before: was, after: now, changed: key(was) !== key(now) };
}

/** A before value that is gone after his words: shown struck through on a changed part. */
export const goneValues = (row: CorrectionRow, language?: string | null): string[] => {
    const kept = new Set(row.after.map(e => entryText(e, language)));
    return row.before.map(e => entryText(e, language)).filter(v => v && !kept.has(v));
};

/** A record the हजेरी door saved holds labour only (B002): its details are refused on the server (lane F1), so here too. */
export const isLabourDoorLog = (log: DailyLog): boolean => log.captureScope === 'labour';
