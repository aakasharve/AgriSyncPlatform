/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b; founder D-132 Q3 = 1 "three things: काम, कधी, किती वेळा", Q4 note, D-136, D-137)
 *
 * The pure model of a PERSON'S OWN schedule on the phone (the server half is SCH-OWN-a / -c):
 *   - `parseOwnVersions` reads the rows the pull carries (Dexie `referenceData` `scheduleTemplates`, raw) and keeps ONLY the rows that name an owner
 *     (`ownerUserId`): a Public sample and a plain Team copy are not his own schedule. A version that has stages but no works yet carries its stages in
 *     `draftStages` (the wire keeps `stages []` for release 1.0.17, M004).
 *   - `buildOwnChains` chains the versions by `previousVersionId` (every save is a NEW row; the one before is never touched).
 *   - `derivedDays` - the days a schedule runs are WORKED OUT from its stages, never typed (P4).
 *   - `validateSchedule` asks the server's day rules (the import's, shared by the edit) BEFORE anything is queued, so a draft the server would
 *     refuse for good never leaves the phone. The server still decides.
 * No React, no Dexie, no network here.
 */

export type WorkPart = 'irrigation' | 'nutrition' | 'spray' | 'work';
export type WorkMode = 'one_time' | 'every_n_days' | 'per_week';

export interface OwnStage { name: string; startDay: number; endDay: number }

export interface OwnWork {
    name: string;
    part: WorkPart;
    startDay: number;
    endDay: number;
    mode: WorkMode;
    /** Every N days, or times a week; 1 for a one-time work. */
    intervalDays: number;
    /** WORK-ID's op_* key when the row carried a well-formed one. */
    operationKey?: string;
}

/** The four made-for TAGS (list codes; absent = none). Tags only: the server never refuses a follow because of them (Q10 = 1). */
export interface MadeForTags { variety?: string; soilType?: string; region?: string; climate?: string }
export const MADE_FOR_KEYS = ['variety', 'soilType', 'region', 'climate'] as const;
export type MadeForKey = typeof MADE_FOR_KEYS[number];

/** What a version SAYS - the part that is compared between two versions and that a save writes whole. */
export interface ScheduleBody {
    name: string;
    stages: OwnStage[];
    works: OwnWork[];
    madeFor: MadeForTags;
}

export interface OwnVersion extends ScheduleBody {
    id: string;
    /** The crop type name as the server lists it ("Grapes"). */
    cropType: string;
    /** The row's own number ("v3" -> 3); null while unknown (the chain then counts its place). */
    version: number | null;
    ownerUserId: string;
    madeByUserId: string | null;
    madeAtUtc: string | null;
    previousVersionId: string | null;
    hasStoredDays: boolean;
}

const PARTS: ReadonlySet<string> = new Set(['irrigation', 'nutrition', 'spray', 'work']);
const MODES: ReadonlySet<string> = new Set(['one_time', 'every_n_days', 'per_week']);
const OPERATION_KEY = /^op_[a-z0-9_]+$/;

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const whole = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);

/** The server's `Part` ("Spray", "Irrigation", "Nutrition", "Work"), else the category label, as the contract's lower-case part. */
function partOf(activity: Record<string, unknown>): WorkPart {
    const part = text(activity.part).toLowerCase();
    if (PARTS.has(part)) return part as WorkPart;
    const category = text(activity.category).toLowerCase();
    if (category.startsWith('irrig')) return 'irrigation';
    if (category.startsWith('fert') || category.startsWith('nutri')) return 'nutrition';
    if (category.startsWith('spray')) return 'spray';
    return 'work';
}

function stageOf(raw: unknown): OwnStage | null {
    if (!raw || typeof raw !== 'object') return null;
    const s = raw as Record<string, unknown>;
    const name = text(s.name);
    const startDay = whole(s.startDay);
    const endDay = whole(s.endDay);
    return name && startDay !== null && endDay !== null ? { name, startDay, endDay } : null;
}

function workOf(raw: unknown): OwnWork | null {
    if (!raw || typeof raw !== 'object') return null;
    const a = raw as Record<string, unknown>;
    const name = text(a.name);
    const startDay = whole(a.startDay);
    if (!name || startDay === null) return null;
    const endDay = whole(a.endDay) ?? startDay;
    const mode = MODES.has(text(a.frequencyMode)) ? text(a.frequencyMode) as WorkMode : 'one_time';
    const interval = whole(a.intervalDays);
    const key = text(a.operationKey);
    return {
        name, part: partOf(a), startDay, endDay, mode,
        intervalDays: mode === 'one_time' || interval === null || interval < 1 ? 1 : interval,
        ...(key.length <= 40 && OPERATION_KEY.test(key) ? { operationKey: key } : {}),
    };
}

function tagsOf(row: Record<string, unknown>): MadeForTags {
    const out: MadeForTags = {};
    for (const key of MADE_FOR_KEYS) {
        const value = text(row[key]);
        if (value) out[key] = value;
    }
    return out;
}

const versionNumber = (tag: unknown): number | null => {
    const m = /^v(\d+)$/i.exec(text(tag));
    return m ? Number(m[1]) : null;
};

/** Every row of the pull that names an owner, read; rows that cannot be read are left out (never guessed). */
export function parseOwnVersions(raw: readonly unknown[]): OwnVersion[] {
    const out: OwnVersion[] = [];
    for (const item of raw ?? []) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;
        const ownerUserId = text(row.ownerUserId);
        const id = text(row.id);
        if (!ownerUserId || !id) continue;
        const stored = row.hasStoredDays === true;
        const stageSource = stored ? row.stages : (Array.isArray(row.draftStages) ? row.draftStages : []);
        const stages = (Array.isArray(stageSource) ? stageSource : []).map(stageOf).filter((s): s is OwnStage => s !== null);
        const works = stored ? (Array.isArray(row.activities) ? row.activities : []).map(workOf).filter((w): w is OwnWork => w !== null) : [];
        out.push({
            id,
            name: text(row.name),
            cropType: text(row.cropType),
            version: versionNumber(row.rowVersionTag),
            ownerUserId,
            madeByUserId: text(row.madeByUserId) || null,
            madeAtUtc: text(row.madeAtUtc) || null,
            previousVersionId: text(row.previousVersionId) || null,
            hasStoredDays: stored,
            stages, works,
            madeFor: tagsOf(row),
        });
    }
    return out;
}

/** The checked (or any) library row read as a body - the base of "start from a checked schedule". */
export function parseScheduleBody(raw: unknown): (ScheduleBody & { id: string; cropType: string }) | null {
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as Record<string, unknown>;
    const id = text(row.id);
    if (!id) return null;
    const stages = (Array.isArray(row.stages) ? row.stages : []).map(stageOf).filter((s): s is OwnStage => s !== null);
    const works = (Array.isArray(row.activities) ? row.activities : []).map(workOf).filter((w): w is OwnWork => w !== null);
    return { id, name: text(row.name), cropType: text(row.cropType), stages, works, madeFor: tagsOf(row) };
}

export interface OwnChain {
    /** The first version's id (the chain's name). */
    id: string;
    cropType: string;
    /** Oldest first. Every `version` is filled (the row's own number, else its place in the chain). */
    versions: OwnVersion[];
    latest: OwnVersion;
    /** The first row the phone holds names a version before it that the phone does not hold. */
    missingBefore: boolean;
}

const madeAt = (v: OwnVersion): number => (v.madeAtUtc ? Date.parse(v.madeAtUtc) || 0 : 0);

/** Chains the versions: a row whose previous version is not among the rows starts a chain; the newest row of a chain is its latest. */
export function buildOwnChains(versions: readonly OwnVersion[]): OwnChain[] {
    const byId = new Map(versions.map(v => [v.id, v]));
    const childrenOf = new Map<string, OwnVersion[]>();
    for (const v of versions) {
        if (v.previousVersionId && byId.has(v.previousVersionId)) {
            childrenOf.set(v.previousVersionId, [...(childrenOf.get(v.previousVersionId) ?? []), v]);
        }
    }
    const roots = versions.filter(v => !v.previousVersionId || !byId.has(v.previousVersionId));
    return roots.map(root => {
        const path: OwnVersion[] = [root];
        // Follow the branch that was made last, so a fork never loses the newest row.
        let current = root;
        const seen = new Set([root.id]);
        for (;;) {
            const kids = (childrenOf.get(current.id) ?? []).filter(k => !seen.has(k.id));
            if (kids.length === 0) break;
            const pick = [...kids].sort((a, b) => madeAt(b) - madeAt(a))[0];
            path.push(pick);
            seen.add(pick.id);
            current = pick;
        }
        const numbered = path.map((v, i) => ({ ...v, version: v.version ?? i + 1 }));
        return {
            id: root.id,
            cropType: numbered[numbered.length - 1].cropType || root.cropType,
            versions: numbered,
            latest: numbered[numbered.length - 1],
            missingBefore: !!root.previousVersionId,
        };
    });
}

/** The days a schedule runs: the last stage day + 1 (the server counts a schedule's days the same way). 0 while there is no stage. */
export function derivedDays(stages: readonly OwnStage[]): number {
    return stages.length === 0 ? 0 : Math.max(...stages.map(s => s.endDay)) + 1;
}

export type ScheduleProblemCode = 'noStage' | 'stageName' | 'stageDays' | 'workName' | 'workDays' | 'workOutside' | 'repeat' | 'tooMany';
export interface ScheduleProblem { code: ScheduleProblemCode; /** The stage or work it is about. */ about?: string }

export const MAX_STAGES = 40;
export const MAX_WORKS = 300;
export const MAX_DAY = 3650;
export const MAX_STAGE_NAME = 80;
export const MAX_WORK_NAME = 120;

/**
 * The server's rules for the next version written whole (`ScheduleTemplate.Import.cs`: CheckStages, CheckActivityDays, CheckEditBounds), asked here
 * first. null = nothing the server would refuse for good.
 */
export function validateSchedule(stages: readonly OwnStage[], works: readonly OwnWork[]): ScheduleProblem | null {
    if (stages.length === 0) return { code: 'noStage' };
    if (stages.length > MAX_STAGES || works.length > MAX_WORKS) return { code: 'tooMany' };
    for (const s of stages) {
        const name = s.name.trim();
        if (!name || name.length > MAX_STAGE_NAME) return { code: 'stageName', about: s.name };
        if (s.startDay < 0 || s.endDay < s.startDay || s.endDay > MAX_DAY) return { code: 'stageDays', about: name };
    }
    const lastDay = Math.max(...stages.map(s => s.endDay));
    for (const w of works) {
        const name = w.name.trim();
        if (name.length < 2 || name.length > MAX_WORK_NAME) return { code: 'workName', about: w.name };
        if (w.startDay < 0 || w.endDay < w.startDay || w.endDay > MAX_DAY) return { code: 'workDays', about: name };
        if (!stages.some(s => s.startDay <= w.startDay && w.startDay <= s.endDay) || w.endDay > lastDay) return { code: 'workOutside', about: name };
        const ok = w.mode === 'per_week' ? w.intervalDays >= 1 && w.intervalDays <= 7 : w.intervalDays >= 1 && w.intervalDays <= MAX_DAY;
        if (!ok) return { code: 'repeat', about: name };
    }
    return null;
}
