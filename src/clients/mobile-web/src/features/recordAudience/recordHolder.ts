/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 lane PRV fix pass 2 — who may choose who sees a record: the farm's REGISTRANT (its `ownerUserId`), the same
 * person the server takes as the record holder (`FarmReadScope.IsRecordHolder`, the rule membership decisions use) and the
 * same rule `teamModel.ts` applies. A second PrimaryOwner seat is not him: the server would refuse his choice, so the phone
 * never offers it (a lock chip for a choice the server refused would be a false promise of privacy).
 */
import { useEffect, useState } from 'react';
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';

/** Is <paramref name="userId"/> the registrant of this farm, as this phone holds the farm? Unknown = no. */
export async function isFarmRegistrant(farmId: string | null | undefined, userId: string | null | undefined): Promise<boolean> {
    if (!farmId || !userId) return false;
    const row = await getDatabase().farms.get(farmId);
    const owner = (row?.payload as { ownerUserId?: unknown } | null | undefined)?.ownerUserId;
    return typeof owner === 'string' && owner.toLowerCase() === userId.toLowerCase();
}

/** The same, for a screen: false until the farm row has been read (never a flash of the picker). */
export function useIsFarmRegistrant(farmId: string | null | undefined, userId: string | null | undefined): boolean {
    const [registrant, setRegistrant] = useState(false);
    useEffect(() => {
        let live = true;
        isFarmRegistrant(farmId, userId)
            .then(answer => { if (live) setRegistrant(answer); })
            .catch(error => {
                // Never silent; and never the picker on an unreadable farm row.
                console.warn('recordHolder: the farm row could not be read', error);
                if (live) setRegistrant(false);
            });
        return () => { live = false; };
    }, [farmId, userId]);
    return registrant;
}
