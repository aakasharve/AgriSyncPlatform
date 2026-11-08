// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-1 (founder D-24c, D-24a, D-29, D-30) — plannedwork.create:
// make a task or reminder. Queued like every other change, so it works with no internet; the server decides when it
// arrives (doctrine P10).
//
//   - `plannedWorkId`: the task's own id, made on the phone: a re-sent task is the same task.
//   - `farmId`: the task's farm (the server refuses a plot of any other farm, E4; the phone's outbox reads it).
//   - `title`: his words for the work (1..200).
//   - `scope` + `plotIds`: 'Plot' = exactly one plot, 'MultiPlot' = two or more of this farm, 'Farm' and 'Unspecified' = none.
//   - `plannedDate` OR `looseWhen` ('Week' | 'Month' | 'Anytime'), never both; both are optional (an undated task is never late).
//     `plannedTime` (HH:mm) only with a date.
//   - `assigneeUserId`: absent or the maker himself = a personal reminder (grants no authority); another person = work given to
//     one accountable person (the server asks "assign work" on this farm and that he is an Active member covering the plots).
//   - `crewText`, `expectedHeadcount`, `quantityText`, `payMode` ('Cash' | 'Daily' | 'Contract' | 'Later'): WORDS ONLY
//     (D-24a, P4). They never become an attendance, a wage, a cost, a job card or a payment. Crew words and a headcount need
//     an assignee.
//   - `sourceKind`: how it was made ('Typed' | 'PlanForm' | 'Spoken'); the reminder's source line (D-78).
//   - `recordedOn`: the farm-local day it was made (D-29), yyyy-MM-dd. The server uses its own farm-local day when absent and
//     refuses a day more than two days away from it.
//
// Who made it, when, and its status are the server's. There is no `status`, `createdBy` or `source` field on purpose.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const PlannedWorkScopeEnum = z.enum(['Plot', 'MultiPlot', 'Farm', 'Unspecified']);
export const PlannedWorkLooseWhenEnum = z.enum(['Week', 'Month', 'Anytime']);
export const PlannedWorkPayModeEnum = z.enum(['Cash', 'Daily', 'Contract', 'Later']);
export const PlannedWorkSourceKindEnum = z.enum(['Typed', 'PlanForm', 'Spoken']);

const ZDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be yyyy-MM-dd');
const ZTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:mm');

export const PlannedWorkCreatePayload = z.object({
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
    sourceKind: PlannedWorkSourceKindEnum.optional(),
    recordedOn: ZDay.optional(),
}).strict();

export type PlannedWorkCreatePayloadType = z.infer<typeof PlannedWorkCreatePayload>;
