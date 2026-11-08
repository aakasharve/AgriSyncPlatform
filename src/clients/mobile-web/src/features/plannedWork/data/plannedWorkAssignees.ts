/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-2 Task 0 item 6, founder D-24c, D-26) - the people the caller may
 * hand work to: the phone client of `GET /shramsafal/farms/{farmId}/planned-work/assignees` (the server filters; the primary
 * owner and an AssignWork holder get the same list, anyone else a 403) and the last answer kept per person and farm in `appMeta`
 * (no Dexie version: the `accessScopeStore.ts` precedent), so the "कोणाला सोपवायचं" choices still stand when there is no net.
 *
 * The phone never decides who may be chosen: it shows what the server last listed. A person the server no longer lists is not
 * offered once the phone is online again; the server still refuses a wrong choice (`AssigneeNotMember`, `AssigneeOutsidePlots`).
 */
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import type { PlannedWorkAssigneeDto } from '../../../infrastructure/api/plannedWorkDtos';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';

export const assigneesPath = (farmId: string): string => `/shramsafal/farms/${farmId}/planned-work/assignees`;

/** One appMeta row per person and farm: another person on the same phone never reads this person's list. */
export const assigneesMetaKey = (userId: string, farmId: string): string => `shramsafal_planned_work_assignees_v1:${userId}:${farmId}`;

export interface StoredAssignees {
    receivedAtUtc: string;
    assignees: PlannedWorkAssigneeDto[];
}

export interface AssigneeList {
    assignees: PlannedWorkAssigneeDto[];
    /** `server` = asked just now; `cache` = the last answer kept on this phone; `none` = nothing known. */
    source: 'server' | 'cache' | 'none';
    receivedAtUtc: string | null;
}

export async function fetchAssignees(farmId: string): Promise<PlannedWorkAssigneeDto[]> {
    const response = await agriSyncClient.http.get<PlannedWorkAssigneeDto[]>(assigneesPath(farmId));
    return Array.isArray(response.data) ? response.data : [];
}

export async function readCachedAssignees(userId: string, farmId: string): Promise<StoredAssignees | null> {
    const row = await getDatabase().appMeta.get(assigneesMetaKey(userId, farmId));
    const value = row?.value as StoredAssignees | undefined;
    return value && Array.isArray(value.assignees) ? value : null;
}

export async function saveAssignees(userId: string, farmId: string, assignees: PlannedWorkAssigneeDto[]): Promise<StoredAssignees> {
    const receivedAtUtc = new Date().toISOString();
    const value: StoredAssignees = { receivedAtUtc, assignees };
    await getDatabase().appMeta.put({ key: assigneesMetaKey(userId, farmId), value, updatedAt: receivedAtUtc });
    return value;
}

/**
 * The list for the form: from the server when there is a net (and keep it), else the kept one. A refusal (403: this person
 * may not hand work to others) keeps nothing and answers an empty list; a failure with no net reads the kept answer.
 */
export async function loadAssignees(userId: string, farmId: string): Promise<AssigneeList> {
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (online) {
        try {
            const fresh = await fetchAssignees(farmId);
            const saved = await saveAssignees(userId, farmId, fresh);
            return { assignees: fresh, source: 'server', receivedAtUtc: saved.receivedAtUtc };
        } catch (error) {
            const status = (error as { response?: { status?: number } } | null)?.response?.status;
            if (status === 403) {
                // The server says this seat may not hand work over (any more): the list kept from before is not offered either.
                await getDatabase().appMeta.delete(assigneesMetaKey(userId, farmId));
                return { assignees: [], source: 'none', receivedAtUtc: null };
            }
        }
    }
    const kept = await readCachedAssignees(userId, farmId);
    return kept ? { assignees: kept.assignees, source: 'cache', receivedAtUtc: kept.receivedAtUtc } : { assignees: [], source: 'none', receivedAtUtc: null };
}
