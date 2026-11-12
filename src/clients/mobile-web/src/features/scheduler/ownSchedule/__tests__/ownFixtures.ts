/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b) - real-shaped rows of the server's `ScheduleTemplateDto`
 * for a person's own schedule (SCH-OWN-a/-c): the nine END fields (ownerUserId, madeByUserId, madeAtUtc, previousVersionId, the four
 * made-for tags, draftStages), `hasStoredDays`, a stored activity with `part`, and `check: null` (D-82 = 3). No preview data.
 */
export const OWNER = '0a0a0a0a-0000-4000-8000-00000000000a';
export const TYPIST = '0b0b0b0b-0000-4000-8000-00000000000b';
export const FARM = '11111111-1111-4111-8111-111111111111';

export const id = (n: number): string => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export interface RawActivity {
    name: string;
    part?: string;
    startDay: number;
    endDay: number;
    frequencyMode?: 'one_time' | 'every_n_days' | 'per_week';
    intervalDays?: number | null;
    operationKey?: string | null;
}

export const act = (a: RawActivity) => ({
    name: a.name,
    category: 'Irrigation',
    stageName: 'x',
    startDay: a.startDay,
    endDay: a.endDay,
    frequencyMode: a.frequencyMode ?? 'one_time',
    intervalDays: a.intervalDays ?? null,
    operationKey: a.operationKey ?? null,
    part: a.part ?? 'Work',
});

export interface RawOwn {
    id: string;
    name?: string;
    cropType?: string;
    version?: number;
    previousVersionId?: string | null;
    madeByUserId?: string | null;
    madeAtUtc?: string | null;
    ownerUserId?: string | null;
    stages?: Array<{ name: string; startDay: number; endDay: number }>;
    activities?: RawActivity[];
    draftStages?: Array<{ name: string; startDay: number; endDay: number }> | null;
    variety?: string | null;
    soilType?: string | null;
    region?: string | null;
    climate?: string | null;
}

/** One version row as the pull carries it for an own schedule (Team scope, `check` null). */
export function ownRow(r: RawOwn): Record<string, unknown> {
    const stages = r.stages ?? [];
    const activities = (r.activities ?? []).map(act);
    const stored = stages.length > 0 && activities.length > 0;
    return {
        id: r.id,
        name: r.name ?? 'माझं द्राक्ष शेड्यूल',
        cropType: r.cropType ?? 'Grapes',
        totalDays: stages.length === 0 ? 0 : Math.max(...stages.map(s => s.endDay)) + 1,
        stages: stored ? stages : [],
        activities: stored ? activities : [],
        versionHash: '',
        ownerType: 'USER',
        sourceLabel: null,
        check: null,
        rowVersionTag: `v${r.version ?? 1}`,
        hasStoredDays: stored,
        scope: 'Team',
        ownerUserId: r.ownerUserId === undefined ? OWNER : r.ownerUserId,
        madeByUserId: r.madeByUserId === undefined ? OWNER : r.madeByUserId,
        madeAtUtc: r.madeAtUtc === undefined ? '2026-11-04T05:00:00Z' : r.madeAtUtc,
        previousVersionId: r.previousVersionId ?? null,
        variety: r.variety ?? null,
        soilType: r.soilType ?? null,
        region: r.region ?? null,
        climate: r.climate ?? null,
        draftStages: r.draftStages ?? (!stored && stages.length > 0 ? stages : null),
    };
}

export const STAGES_A = [
    { name: 'छाटणीनंतर', startDay: 0, endDay: 15 },
    { name: 'फूट वाढ', startDay: 16, endDay: 30 },
    { name: 'फुलोरा ते फळधारणा', startDay: 31, endDay: 60 },
    { name: 'फळवाढ', startDay: 61, endDay: 100 },
];

export const WORKS_A: RawActivity[] = [
    { name: 'ठिबक सिंचन', part: 'Irrigation', startDay: 31, endDay: 60, frequencyMode: 'every_n_days', intervalDays: 5 },
    { name: 'बुरशीनाशक फवारणी', part: 'Spray', startDay: 34, endDay: 55, frequencyMode: 'every_n_days', intervalDays: 7 },
    { name: 'घड विरळणी', part: 'Work', startDay: 38, endDay: 38 },
];
