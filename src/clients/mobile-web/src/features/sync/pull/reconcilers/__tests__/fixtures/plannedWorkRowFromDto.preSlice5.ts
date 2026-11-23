/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 5) - a FROZEN copy of the pull's planned-work DTO parser as the phone carried it BEFORE slice 5
 * (test-branch tip 67b38f93, `plannedWorkReconciler.ts`). The old-phone test runs it against the new server response, so a phone built before the new keys
 * existed is proven to read a plan from the own schedule without crashing and without inventing anything. Never edit: it stands for the old build.
 * (1.0.17 itself never reads `plannedWork` at all - the key is ignored there; `git grep plannedWork b3d28967 -- src/clients/mobile-web/src` finds nothing.)
 */
import type { PlannedWorkDto } from '../../../../../../infrastructure/api/plannedWorkDtos';
import type {
    PlannedWorkConfirmationName, PlannedWorkLooseWhenName, PlannedWorkPayModeName, PlannedWorkRow, PlannedWorkScopeName,
    PlannedWorkSourceKindName, PlannedWorkSourceName, PlannedWorkStatusName, ReminderCategoryName,
} from '../../../../../../infrastructure/storage/plannedWorkRow';

const STATUSES: readonly PlannedWorkStatusName[] = ['Open', 'Assigned', 'Seen', 'Accepted', 'Done', 'Cancelled'];
const SCOPES: readonly PlannedWorkScopeName[] = ['Plot', 'MultiPlot', 'Farm', 'Unspecified'];
const LOOSE: readonly PlannedWorkLooseWhenName[] = ['Week', 'Month', 'Anytime'];
const PAY: readonly PlannedWorkPayModeName[] = ['Cash', 'Daily', 'Contract', 'Later'];
const SOURCES: readonly PlannedWorkSourceName[] = ['Planning', 'VoiceLog', 'LogLeftover', 'Schedule'];
const KINDS: readonly PlannedWorkSourceKindName[] = ['Typed', 'PlanForm', 'Spoken', 'Leftover'];
const CONFIRMATIONS: readonly PlannedWorkConfirmationName[] = ['Confirmed', 'Disputed', 'Waiting'];
const CATEGORIES: readonly ReminderCategoryName[] = ['FromPlanning', 'FromSchedule', 'FromLogs'];
/** Lane REM-1 (additive, P11): a flag the server did not send is "not told", never "no" - null. */
const flag = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);

const known = <T extends string>(list: readonly T[], value: unknown): T | null =>
    typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : null;
const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []);

/** The phone's row for a task the server sent, or null for a row it cannot read (it keeps its old copy and the next pull retries). */
export function preSlice5PlannedWorkRowFromDto(dto: PlannedWorkDto | null | undefined): PlannedWorkRow | null {
    if (!dto || typeof dto.id !== 'string' || !dto.id || typeof dto.farmId !== 'string' || !dto.farmId) return null;
    const status = known(STATUSES, dto.status);
    const scope = known(SCOPES, dto.scope);
    if (!status || !scope || typeof dto.title !== 'string' || typeof dto.modifiedAtUtc !== 'string' || !dto.modifiedAtUtc) return null;
    return {
        id: dto.id,
        farmId: dto.farmId,
        title: dto.title,
        scope,
        plannedDate: text(dto.plannedDate),
        looseWhen: known(LOOSE, dto.looseWhen),
        plannedTime: text(dto.plannedTime),
        assigneeUserId: text(dto.assigneeUserId),
        crewText: text(dto.crewText),
        expectedHeadcount: typeof dto.expectedHeadcount === 'number' ? dto.expectedHeadcount : null,
        quantityText: text(dto.quantityText),
        payMode: known(PAY, dto.payMode),
        note: text(dto.note),
        status,
        source: known(SOURCES, dto.source) ?? 'Planning',
        sourceKind: known(KINDS, dto.sourceKind),
        sourceDailyLogId: text(dto.sourceDailyLogId),
        sourceLogTaskId: text(dto.sourceLogTaskId),
        sourcePlotId: text(dto.sourcePlotId),
        recordedOn: typeof dto.recordedOn === 'string' ? dto.recordedOn : '',
        linkedDailyLogIds: ids(dto.linkedDailyLogIds),
        createdByUserId: typeof dto.createdByUserId === 'string' ? dto.createdByUserId : '',
        createdAtUtc: typeof dto.createdAtUtc === 'string' ? dto.createdAtUtc : dto.modifiedAtUtc,
        modifiedAtUtc: dto.modifiedAtUtc,
        seenAtUtc: text(dto.seenAtUtc),
        acceptedAtUtc: text(dto.acceptedAtUtc),
        doneAtUtc: text(dto.doneAtUtc),
        doneByUserId: text(dto.doneByUserId),
        cancelledAtUtc: text(dto.cancelledAtUtc),
        cancelledByUserId: text(dto.cancelledByUserId),
        cancelReason: text(dto.cancelReason),
        plots: (Array.isArray(dto.plots) ? dto.plots : [])
            .filter(p => p && typeof p.plotId === 'string' && p.plotId)
            .map(p => ({
                plotId: p.plotId,
                status: p.status === 'Done' ? 'Done' as const : 'Pending' as const,
                doneAtUtc: text(p.doneAtUtc),
                doneByUserId: text(p.doneByUserId),
                linkedDailyLogIds: ids(p.linkedDailyLogIds),
                confirmationState: known(CONFIRMATIONS, p.confirmationState),
            })),
        // Lane L8c-3 (additive, P11): a word we do not know, or none, is no word.
        confirmationState: known(CONFIRMATIONS, dto.confirmationState),
        // Lane REM-1 (additive, P11): who made it, its source, the voice and money answers, the two card facts.
        createdByName: text(dto.createdByName),
        category: known(CATEGORIES, dto.category),
        mayPlayVoice: flag(dto.mayPlayVoice),
        wordsWithheld: flag(dto.wordsWithheld),
        makerAlwaysShown: flag(dto.makerAlwaysShown),
        fromChosenPeopleRecord: flag(dto.fromChosenPeopleRecord),
    };
}

