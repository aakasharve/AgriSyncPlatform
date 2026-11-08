// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-1 (founder D-24c) — plannedwork.edit: change when, where, who
// and what of a task. A FULL replace of the words in `plannedwork.create` (an omitted word is cleared), so one queued edit
// leaves the task exactly as the phone shows it. Moving the task to another person (or taking it from one) is a reassign:
// the server sends the task to the new assignee and tells the old one's phone to forget it.
//
// `plannedWorkId` + `farmId` name the task (a task of any other farm is "not found", E4). There is no `status`, no maker and
// no `recordedOn` here: the day a task was made never changes.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';
import {
    PlannedWorkScopeEnum,
    PlannedWorkLooseWhenEnum,
    PlannedWorkPayModeEnum,
} from './plannedwork_create.zod';

const ZDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be yyyy-MM-dd');
const ZTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:mm');

export const PlannedWorkEditPayload = z.object({
    plannedWorkId: ZGuid,
    farmId: ZGuid,
    title: z.string().min(1).max(200),
    scope: PlannedWorkScopeEnum,
    plotIds: z.array(ZGuid).max(200).optional(),
    plannedDate: ZDay.optional(),
    looseWhen: PlannedWorkLooseWhenEnum.optional(),
    plannedTime: ZTime.optional(),
    assigneeUserId: ZGuid.optional(),
    crewText: z.string().min(1).max(100).optional(),
    expectedHeadcount: z.number().int().min(1).max(999).optional(),
    quantityText: z.string().min(1).max(200).optional(),
    payMode: PlannedWorkPayModeEnum.optional(),
    note: z.string().min(1).max(1000).optional(),
}).strict();

export type PlannedWorkEditPayloadType = z.infer<typeof PlannedWorkEditPayload>;
