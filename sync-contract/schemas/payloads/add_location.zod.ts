import { z } from 'zod';
import { ZIsoDate } from './_shared.zod';

// add_location is rejected by the server as a standalone mutation
// ("Send location with create_daily_log"), but the shape is reserved
// for forward-compat. Mirrors
// PushSyncBatchHandler.LocationMutationPayload — the same record the
// server reads when location rides along on create_daily_log /
// add_cost_entry.
export const AddLocationPayload = z.object({
  latitude: z.number(),
  longitude: z.number(),
  accuracyMeters: z.number().nonnegative(),
  altitude: z.number().optional(),
  capturedAtUtc: ZIsoDate,
  provider: z.string().min(1),
  permissionState: z.string().min(1),
});

export type AddLocationPayloadType = z.infer<typeof AddLocationPayload>;
