// spec: plr-d10 lane PRV (founder D-26, 2026-10-27; Q3 2026-10-30 "in this release") — the farm's primary account
// holder chooses who sees ONE record: the normal team, selected people, or only himself. Queued like every other
// change, so it works with no internet and the server decides when it arrives (doctrine P10). There is no REST path.
//
//   - `recordKind`: 'DailyLog' (a work record) or 'CostEntry' (a money record).
//   - `audience`: 'Team' | 'Selected' | 'OnlyMe'.
//   - `selectedUserIds`: the people he chose — at least one for 'Selected', none for the other two.
//   - `changedAtUtc`: when the phone made the choice (recorded, never trusted for ordering).
//
// The server checks, in code (E4): the sender is the primary account holder of THE RECORD'S farm; every chosen person
// holds an Active seat on that same farm; the record is one whose audience may be set. The idempotency key is the
// envelope's `clientRequestId` (the server dedupes on device + request id).
import { z } from 'zod';
import { ZGuid, ZIsoDate } from './_shared.zod';

export const RecordKindEnum = z.enum(['DailyLog', 'CostEntry']);
export const RecordAudienceEnum = z.enum(['Team', 'Selected', 'OnlyMe']);

// A plain object (the allow-list parity gate reads its keys). The cross-field rule — 'Selected' names at least one
// person, 'Team' and 'OnlyMe' name nobody — is `setRecordAudienceNamesPeopleRightly` below, and the server refuses a
// payload that breaks it (InvalidCommand, parked on every phone).
export const SetRecordAudiencePayload = z.object({
    recordKind: RecordKindEnum,
    recordId: ZGuid,
    audience: RecordAudienceEnum,
    selectedUserIds: z.array(ZGuid).max(50),
    changedAtUtc: ZIsoDate,
});

export type SetRecordAudiencePayloadType = z.infer<typeof SetRecordAudiencePayload>;

export function setRecordAudienceNamesPeopleRightly(payload: SetRecordAudiencePayloadType): boolean {
    return (payload.audience === 'Selected') === (payload.selectedUserIds.length > 0)
        && new Set(payload.selectedUserIds).size === payload.selectedUserIds.length;
}
