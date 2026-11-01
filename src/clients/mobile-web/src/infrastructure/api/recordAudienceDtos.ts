/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 lane PRV (founder D-26) — who may see ONE record, on the /sync/pull wire. Kept beside `dtos.ts` so
 * that file stays under its size cap. Every member is additive and optional (P11): an older server never sends them,
 * and 1.0.17 ignores them.
 */

/** Who may see a record. `Team` (the normal team) is never sent: absent = the normal team. */
export type RecordAudienceName = 'Team' | 'Selected' | 'OnlyMe';

/** The two record kinds an audience is set on, as the wire names them. */
export type RecordKindName = 'DailyLog' | 'CostEntry';

/**
 * On a work record (`DailyLogDto`) and a money record (`CostEntryDto`): sent ONLY to the farm's primary account
 * holder (his picker and lock chip read it). Everyone else is told nothing.
 */
export interface RecordAudienceFields {
    audience?: RecordAudienceName | null;
    /** The people he chose (`Selected`). */
    audienceUserIds?: string[] | null;
}

/** A record taken back from this phone: kind + id, nothing else. The phone removes it and what hangs from it. */
export interface WithdrawnRecordDto {
    kind: RecordKindName;
    id: string;
}

/** One kind of record on one day that this person's totals leave out by rule (W4). */
export interface WithheldRecordDayDto {
    kind: 'work' | 'money';
    /** `YYYY-MM-DD`, the record's own day. */
    date: string;
}

export interface PullAudienceFields {
    /** Records this person may no longer see (absent = none, or an older server). */
    withdrawnRecords?: WithdrawnRecordDto[] | null;
}
