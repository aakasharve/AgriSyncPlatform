// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT2, Task 2; founder D-92 / D-95) — his answer about ONE product of ONE
// saved record: हो / नाही / फोटो. Queued like every other change, so it works with no internet; the server decides when it
// arrives (doctrine P10).
//
//   - `assertionId`: the answer's own id, made on the phone: a re-sent answer is the same row.
//   - `farmId`: the record's farm (the server refuses a record of any other farm, E4; the phone's outbox reads it).
//   - `dailyLogId`: the saved record.
//   - `inputEventId` + `mixIndex`: which product — the input event's id in the record's content (`inputs[].id`) and the slot in
//     its `mix[]`. The server takes his words for the product from the STORED content, never from this payload: there is no
//     `spokenName` field here on purpose.
//   - `verdict`: 'confirmed' (needs `catalogProductId`, a product of the ShramSafal library), 'rejected', or 'photo'
//     (a packet photo; `attachmentId` names it).
//   - `catalogVersion`: the library version the phone matched against (`inputs-2.4`).
//
// Who answered, when, and whether it is the CHECK are the server's: the authenticated sender, the server's clock, and whether
// the sender holds the confirm-records authority on the farm (founder D-95: the speaker's own answer is kept as his; only a
// holder of that authority gives the check). There is no `isCheck` field. An answer never changes the record: not its
// content version, not its tasks, not a quantity (doctrine P7).
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const AssertInputIdentityVerdictEnum = z.enum(['confirmed', 'rejected', 'photo']);

export const AssertInputIdentityPayload = z.object({
    assertionId: ZGuid,
    farmId: ZGuid,
    dailyLogId: ZGuid,
    inputEventId: z.string().min(1).max(128),
    mixIndex: z.number().int().min(0),
    verdict: AssertInputIdentityVerdictEnum,
    catalogProductId: z.string().min(1).max(128).optional(),
    catalogVersion: z.string().min(1).max(64),
    attachmentId: ZGuid.optional(),
}).strict();

export type AssertInputIdentityPayloadType = z.infer<typeof AssertInputIdentityPayload>;
