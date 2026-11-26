// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, founder 27 Nov: "send it to server; the phone is only a door")
//
// farmsetup.water_source.save - one water source of a FARM with its WHOLE motor list, written on the server for every phone of the farm (D-9).
// The source and its motors are ONE versioned unit: the screen saves them together, and a motor that is not in `motors` is removed (its plot links too).
// A NEW name (strict push rule: no key is added to an old payload). Who may: the existing farm-setup authority (शेताची रचना बदलणे).
//
//   - `waterSourceId`: made on the phone (a bare GUID). The first save of an id makes the source; a later save edits it.
//   - `baseRevision`: 0 for a new source, else the revision the phone last received. A stale revision is refused (ShramSafal.FarmSetup.Conflict),
//     never overwritten; the same content sent again is answered as saved.
//   - Values are lower-case words on the wire; the phone maps its display values. An optional detail that is not known is LEFT OUT (never null).
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const FarmWaterSourceTypeEnum = z.enum(['well', 'borewell', 'canal', 'farm_pond', 'tanker']);
export const FarmMotorPowerSourceEnum = z.enum(['mseb', 'solar', 'generator']);

export const FarmMotorDripSchema = z
    .object({
        pipeSize: z.string().max(8).optional(),
        hasFilter: z.boolean(),
        flowLitresPerHour: z.number().positive().optional(),
    })
    .strict();

export const FarmMotorSchema = z
    .object({
        motorId: ZGuid,
        name: z.string().min(1).max(80),
        hp: z.number().positive().max(500),
        // 1 or 3 (single or three phase); the server refuses any other number.
        phase: z.number().int().min(1).max(3),
        powerSource: FarmMotorPowerSourceEnum,
        powerSourceName: z.string().max(80).optional(),
        drip: FarmMotorDripSchema.optional(),
    })
    .strict();

export const FarmsetupWaterSourceSavePayload = z
    .object({
        farmId: ZGuid,
        waterSourceId: ZGuid,
        baseRevision: z.number().int().min(0),
        name: z.string().min(1).max(80),
        sourceType: FarmWaterSourceTypeEnum,
        isAvailable: z.boolean(),
        notes: z.string().max(300).optional(),
        motors: z.array(FarmMotorSchema).max(12),
    })
    .strict();

export type FarmsetupWaterSourceSavePayloadType = z.infer<typeof FarmsetupWaterSourceSavePayload>;
