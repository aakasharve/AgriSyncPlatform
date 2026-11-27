// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9; machine types and details: founder 27 Nov, A11.1 / A11.2)
//
// farmsetup.machine.save - one machine of a FARM (machines belong to the whole farm, never to a plot). Name is the only required detail; the rest is
// optional and asked by type (tractor: company, model, HP; blower and sprayer: company, model, nozzles, tank, one free line; others: company, model).
// A NEW name. The first save of an id makes the machine, a later save edits it (the id is kept). `baseRevision` as for a water source.
// An optional detail that is not known is LEFT OUT (never null). No rate or cost here: the "अंदाजे" machine cost is a later step that adds its own fields.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const FarmMachineTypeEnum = z.enum(['tractor', 'blower', 'sprayer', 'rotavator', 'harvester', 'other']);
export const FarmMachineOwnershipEnum = z.enum(['owned', 'rented']);

export const FarmsetupMachineSavePayload = z
    .object({
        farmId: ZGuid,
        machineId: ZGuid,
        baseRevision: z.number().int().min(0),
        name: z.string().min(1).max(80),
        machineType: FarmMachineTypeEnum,
        ownership: FarmMachineOwnershipEnum,
        company: z.string().max(60).optional(),
        model: z.string().max(60).optional(),
        hp: z.number().positive().optional(),
        nozzleCount: z.number().int().positive().optional(),
        tankLitres: z.number().positive().optional(),
        detailLine: z.string().max(200).optional(),
    })
    .strict();

export type FarmsetupMachineSavePayloadType = z.infer<typeof FarmsetupMachineSavePayload>;
