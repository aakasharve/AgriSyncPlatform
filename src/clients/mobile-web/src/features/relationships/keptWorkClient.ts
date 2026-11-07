/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 - lane MU-1 (MU design §11.2). The owner's kept-work read:
 * `GET /shramsafal/farms/{farmId}/kept-work` - the work the server kept for the farm's PRIMARY account holder (refused for want of
 * an authority, or arrived after the authority behind it ended). The server answers 403 to anyone else; this phone never
 * asks unless the server said he is the primary holder. Nothing of the work itself comes back - what, who, when and why only.
 */
import { agriSyncClient } from '../../infrastructure/api/AgriSyncClient';

export type KeptWorkKind = 'refused' | 'arrived_late' | 'cap_reached';

export interface KeptWorkItem {
    id: string;
    kind: KeptWorkKind;
    /** The mutation type ("add_cost_entry") or the entity type ("AttendanceMark") - the phone words it. */
    what: string | null;
    /** The refusal code, or the authority that had ended. */
    why: string | null;
    whoUserId: string;
    whoName: string | null;
    atUtc: string;
    authorityEndedAtUtc: string | null;
}

export async function fetchKeptWork(farmId: string): Promise<KeptWorkItem[]> {
    const response = await agriSyncClient.http.get<KeptWorkItem[]>(`/shramsafal/farms/${farmId}/kept-work`);
    return Array.isArray(response.data) ? response.data : [];
}
