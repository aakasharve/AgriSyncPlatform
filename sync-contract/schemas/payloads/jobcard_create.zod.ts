// T-IGH-02-PAYLOADS: canonical payload schema for jobcard.create.
// Mirrors the backend handler's JobCardCreateMutationPayload record
// + the canonical JobCardLineItemDto in
// src/apps/ShramSafal/ShramSafal.Application/Contracts/Dtos/JobCardLineItemDto.cs.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

const ZLogDate = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

const JobCardLineItem = z.object({
    activityType: z.string().min(1),
    expectedHours: z.number(),
    ratePerHourAmount: z.number(),
    ratePerHourCurrencyCode: z.string().min(1),
    notes: z.string().optional(),
});

export const JobcardCreatePayload = z.object({
    farmId: ZGuid,
    plotId: ZGuid,
    cropCycleId: ZGuid.optional(),
    plannedDate: ZLogDate,
    lineItems: z.array(JobCardLineItem).min(1),
});

export type JobcardCreatePayloadType = z.infer<typeof JobcardCreatePayload>;
