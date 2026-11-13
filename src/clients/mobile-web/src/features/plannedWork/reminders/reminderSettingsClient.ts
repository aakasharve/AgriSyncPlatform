/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane REM-1; founder D-78, D-84 = 1; R17, R21) - the phone's side of the owner's reminder
 * settings: `GET` and `PUT /shramsafal/farms/{farmId}/reminder-settings` and `PUT` / `DELETE .../always-show/{userId}`.
 *
 * ONLINE ONLY (R21): a setting changes who sees what on EVERY phone, so it is never queued and replayed later, out of order. Offline there
 * is no call at all: the answer is `offline`, nothing is kept, nothing changes. A refusal (403) is `forbidden`; any other failure is `failed`.
 * The server's answer is the truth: the screen adopts the settings it returns, never what it asked for.
 */
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';

export type ReminderAudienceName = 'MakerAndOwner' | 'PlotTeam' | 'Planners';

export interface ReminderAlwaysShowView {
    userId: string;
    displayName: string | null;
    addedAtUtc: string;
}

export interface ReminderMemberView {
    userId: string;
    displayName: string | null;
    role: string;
}

export interface ReminderSettingsView {
    farmId: string;
    logRemindersAudience: ReminderAudienceName;
    ownRemindersAudience: ReminderAudienceName;
    scheduleRemindersAudience: ReminderAudienceName;
    updatedByUserId: string | null;
    updatedAtUtc: string | null;
    alwaysShow: ReminderAlwaysShowView[];
    members: ReminderMemberView[];
}

export type ReminderSettingsOutcome =
    | { kind: 'ok'; settings: ReminderSettingsView }
    | { kind: 'offline' }
    | { kind: 'forbidden' }
    | { kind: 'failed' };

export interface ReminderChoices {
    logRemindersAudience?: ReminderAudienceName;
    ownRemindersAudience?: ReminderAudienceName;
    scheduleRemindersAudience?: ReminderAudienceName;
}

export const reminderSettingsPath = (farmId: string): string => `/shramsafal/farms/${farmId}/reminder-settings`;
export const alwaysShowPath = (farmId: string, userId: string): string => `${reminderSettingsPath(farmId)}/always-show/${userId}`;

const online = (): boolean => typeof navigator === 'undefined' || navigator.onLine !== false;

const audience = (value: unknown, fallback: ReminderAudienceName): ReminderAudienceName =>
    value === 'MakerAndOwner' || value === 'PlotTeam' || value === 'Planners' ? value : fallback;

/** The server's body as the screen reads it. A word it does not know falls back to the D-79 base (never a claim the server did not make). */
export function readSettings(body: unknown): ReminderSettingsView | null {
    const b = body as Record<string, unknown> | null;
    if (!b || typeof b.farmId !== 'string') return null;
    const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []);
    return {
        farmId: b.farmId,
        logRemindersAudience: audience(b.logRemindersAudience, 'MakerAndOwner'),
        ownRemindersAudience: audience(b.ownRemindersAudience, 'MakerAndOwner'),
        scheduleRemindersAudience: audience(b.scheduleRemindersAudience, 'PlotTeam'),
        updatedByUserId: typeof b.updatedByUserId === 'string' ? b.updatedByUserId : null,
        updatedAtUtc: typeof b.updatedAtUtc === 'string' ? b.updatedAtUtc : null,
        alwaysShow: list(b.alwaysShow)
            .filter(m => typeof m.userId === 'string')
            .map(m => ({ userId: m.userId as string, displayName: typeof m.displayName === 'string' && m.displayName.trim() ? m.displayName : null, addedAtUtc: typeof m.addedAtUtc === 'string' ? m.addedAtUtc : '' })),
        members: list(b.members)
            .filter(m => typeof m.userId === 'string')
            .map(m => ({ userId: m.userId as string, displayName: typeof m.displayName === 'string' && m.displayName.trim() ? m.displayName : null, role: typeof m.role === 'string' ? m.role : '' })),
    };
}

async function call(run: () => Promise<{ data: unknown }>): Promise<ReminderSettingsOutcome> {
    if (!online()) return { kind: 'offline' };
    try {
        const response = await run();
        const settings = readSettings(response.data);
        return settings ? { kind: 'ok', settings } : { kind: 'failed' };
    } catch (error) {
        const status = (error as { response?: { status?: number } } | null)?.response?.status;
        return status === 403 ? { kind: 'forbidden' } : { kind: 'failed' };
    }
}

export const fetchReminderSettings = (farmId: string): Promise<ReminderSettingsOutcome> =>
    call(() => agriSyncClient.http.get(reminderSettingsPath(farmId)));

export const saveReminderChoices = (farmId: string, choices: ReminderChoices): Promise<ReminderSettingsOutcome> =>
    call(() => agriSyncClient.http.put(reminderSettingsPath(farmId), choices));

export const markAlwaysShow = (farmId: string, userId: string): Promise<ReminderSettingsOutcome> =>
    call(() => agriSyncClient.http.put(alwaysShowPath(farmId, userId)));

export const unmarkAlwaysShow = (farmId: string, userId: string): Promise<ReminderSettingsOutcome> =>
    call(() => agriSyncClient.http.delete(alwaysShowPath(farmId, userId)));
