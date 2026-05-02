// T-IGH-02-PAYLOADS: canonical payload schema for add_location.
//
// The server handler explicitly REJECTS this mutation type as a
// standalone command (see PushSyncBatchHandler.ExecuteMutationAsync's
// "add_location" case): location must travel inside a create_daily_log
// payload, not as a separate mutation. The schema therefore mirrors the
// LocationMutationPayload sub-record so the contract still describes
// the wire shape — clients that mistakenly enqueue a standalone
// add_location at least produce a well-typed payload that the server's
// dedicated rejection branch can surface intelligibly.
import { z } from 'zod';
import { ZIsoDate } from './_shared.zod';

export const AddLocationPayload = z.object({
    latitude: z.number(),
    longitude: z.number(),
    accuracyMeters: z.number(),
    altitude: z.number().optional(),
    capturedAtUtc: ZIsoDate,
    provider: z.string().min(1),
    permissionState: z.string().min(1),
});

export type AddLocationPayloadType = z.infer<typeof AddLocationPayload>;
