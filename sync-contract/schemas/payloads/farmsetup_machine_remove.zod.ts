// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9)
//
// farmsetup.machine.remove - a farm's machine moves to the removed state (never deleted). A NEW name. `baseRevision` must equal the stored revision.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const FarmsetupMachineRemovePayload = z
    .object({
        farmId: ZGuid,
        machineId: ZGuid,
        baseRevision: z.number().int().min(1),
    })
    .strict();

export type FarmsetupMachineRemovePayloadType = z.infer<typeof FarmsetupMachineRemovePayload>;
