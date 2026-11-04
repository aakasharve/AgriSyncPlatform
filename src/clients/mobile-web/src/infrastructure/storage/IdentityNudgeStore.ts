/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID (founder D-54 section 10). The day the calm
 * "यांचा फोन व पिन भरा" list was last shown on this device for a farm, so it appears AT MOST ONCE A DAY. A device
 * preference, not a record (no Dexie table, no bump): a failing store simply means it may show again — never a nag
 * wall, never a block. Per farmer and farm through `storageNamespace`.
 */
import { storageNamespace } from './StorageNamespace';
import { readCachedJson, writeCachedJson } from './LabourLocalStore';

const keyFor = (farmId: string): string => storageNamespace.getKey(`shramsafal_identity_nudge_day_${farmId}`);

/** The local day (yyyy-mm-dd) the list was last shown for this farm, or null. */
export function readIdentityNudgeDay(farmId: string): string | null {
    const raw = readCachedJson(keyFor(farmId));
    return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

export function writeIdentityNudgeDay(farmId: string, day: string): void {
    writeCachedJson(keyFor(farmId), day);
}
