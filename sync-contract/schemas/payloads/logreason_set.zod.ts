// spec: plr-d10-redesign-real-integration-2026-10-25 - lane CMP-D3 (founder D-68 round 2; doctrine P1, P3, P4, P10): "का केलं" - a reason KEPT ON
// the existing record of work, never new work. ONE change = ONE new reason for ONE item of ONE saved record; a later reason for the same
// record + item SUPERSEDES the earlier one (both stay: history is kept, P3).
//
//   - `reasonId`: this reason's own id, made on the phone, so a repeat of the same save is the same row (idempotent).
//   - `farmId` / `dailyLogId`: the record's farm and the record. The record's OWN farm decides on the server (E4).
//   - `workKey`: which item of that record - the work key तुलना gives each piece of work (`ownWork[].workKey`). An item the record does not
//     have is refused.
//   - `kind`: 'Practice' (my way of working), 'Extra' (extra work was needed) or 'Weather' (the weather made the change). Nothing else.
//   - `words`: what he said, at most 1000 characters; omitted when he only picked the picture. Words only: never read for a number (P4).
//   - `saidByVoice`: true when the words came from the mic (the transcript of what he said; the sound itself is not sent here).
//
// The server decides who may set one: whoever may open तुलना (the primary owner, or a seat that holds "तुलना पाहणे") AND may see that
// record. A reason never changes the record: not its words, version, confirmation or verification. There is no REST path.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const LogReasonKindEnum = z.enum(['Practice', 'Extra', 'Weather']);

export const LogReasonSetPayload = z.object({
    reasonId: ZGuid,
    farmId: ZGuid,
    dailyLogId: ZGuid,
    workKey: z.string().min(1).max(100),
    kind: LogReasonKindEnum,
    words: z.string().max(1000).optional(),
    saidByVoice: z.boolean(),
}).strict();

export type LogReasonSetPayloadType = z.infer<typeof LogReasonSetPayload>;
