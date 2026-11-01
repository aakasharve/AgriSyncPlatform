/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 lane PRV (founder D-26) — the holder's narrowed money records, by entry id, kept fresh after every
 * sync and every choice he makes. Only the holder is ever told (the server sends the audience to him alone), so for
 * anyone else this map is empty and reads nothing.
 */
import { useEffect, useState } from 'react';
import { AUDIENCE_CHANGED_EVENT, readMoneyAudiences } from './recordAudienceLocal';
import type { RecordAudienceName } from '../../infrastructure/api/recordAudienceDtos';

export type MoneyAudiences = ReadonlyMap<string, { audience: RecordAudienceName; people: string[] }>;

const NONE: MoneyAudiences = new Map();

export function useMoneyAudiences(isPrimaryHolder: boolean): MoneyAudiences {
    const [map, setMap] = useState<MoneyAudiences>(NONE);
    useEffect(() => {
        if (!isPrimaryHolder) return undefined;
        let live = true;
        const read = () => {
            readMoneyAudiences()
                .then(next => { if (live) setMap(next); })
                .catch(error => console.warn('useMoneyAudiences: the money records could not be read', error));
        };
        read();
        window.addEventListener('agrisync:sync-reconciled', read);
        window.addEventListener(AUDIENCE_CHANGED_EVENT, read);
        return () => {
            live = false;
            window.removeEventListener('agrisync:sync-reconciled', read);
            window.removeEventListener(AUDIENCE_CHANGED_EVENT, read);
        };
    }, [isPrimaryHolder]);
    return isPrimaryHolder ? map : NONE;
}
