/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-P; founder D-146, D-148) - the stored picture of a schedule's maker as an object URL
 * for an `<img>`, or null (the letter or leaf badge then shows).
 *
 * It answers a URL only while the file this phone holds is exactly the one the pull named (`pictureId` AND `pictureSha256`): a replaced or removed picture
 * never shows an old face, and a picture still on its way (or refused) shows the badge, never an error. A live query over Dexie's `schedulePictures`, so
 * a file the downloader has just stored appears without leaving the page. The object URL is revoked when the file changes and when the screen goes
 * away. It never throws (a store that cannot be read is "no picture"), never logs, and never puts the picture anywhere but this `<img>`.
 */
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';

export interface PictureNames {
    pictureId?: string | null;
    pictureSha256?: string | null;
}

export function useSchedulePictureUrl(names: PictureNames | null | undefined): string | null {
    const id = names?.pictureId ?? null;
    const sha = names?.pictureSha256 ?? null;
    const [url, setUrl] = useState<string | null>(null);

    useEffect(() => {
        if (!id || !sha) { setUrl(null); return undefined; }
        let alive = true;
        let current: string | null = null;
        let unsubscribe = () => {};

        const release = () => {
            if (current) {
                try { URL.revokeObjectURL(current); } catch { /* a URL that cannot be revoked is already gone */ }
                current = null;
            }
        };

        try {
            const db = getDatabase();
            const subscription = liveQuery(() => db.schedulePictures.get(id)).subscribe({
                next: row => {
                    if (!alive) return;
                    release();
                    if (row && row.sha256 === sha && row.blob) {
                        try {
                            current = URL.createObjectURL(row.blob);
                        } catch {
                            current = null;
                        }
                    }
                    setUrl(current);
                },
                error: () => { if (alive) { release(); setUrl(null); } },
            });
            unsubscribe = () => subscription.unsubscribe();
        } catch {
            setUrl(null);
        }

        return () => {
            alive = false;
            unsubscribe();
            release();
        };
    }, [id, sha]);

    return id && sha ? url : null;
}
