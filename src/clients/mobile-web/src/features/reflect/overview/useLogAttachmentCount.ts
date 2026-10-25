/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6)
 *
 * How many files (photos, receipts) are attached to one log — the count the old plot card and the old
 * page each read with their own copy of this effect. One copy now. Unreadable → 0 (the badge then hides,
 * which is what both copies did).
 */
import { useEffect, useState } from 'react';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';

export function useLogAttachmentCount(logId: string | undefined): number {
    const [count, setCount] = useState(0);
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            if (!logId) { if (!cancelled) setCount(0); return; }
            try {
                const n = await getDatabase().attachments.where('linkedEntityId').equals(logId).count();
                if (!cancelled) setCount(n);
            } catch {
                if (!cancelled) setCount(0);
            }
        };
        void load();
        return () => { cancelled = true; };
    }, [logId]);
    return count;
}
