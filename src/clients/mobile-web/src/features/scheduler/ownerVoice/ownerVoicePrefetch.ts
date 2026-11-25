// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b, CTO gate; P10 offline) - right after a pull lands (outside its transaction), the clips of every owner's message
// this phone holds are fetched and kept, and the checked new version a change names is kept for its "now", with NO screen open. A farmer who syncs at home and opens the
// Schedule tab in the field with no signal still hears them. The clip route needs a farm: tried farm by farm (a farm whose plots do not follow that schedule is answered 404
// and passed over). A kept clip is never fetched again. Never throws; does nothing with no signal.
import { apiFetch } from '../../../infrastructure/api/apiFetch';
import type { AgriLogDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { loadDayCards } from '../dayCards/dayCardsStore';
import { clipIdsOf, fetchOwnerClips, readOwnerVoice, type ClipSend } from './ownerVoiceStore';

export async function prefetchOwnerVoiceAfterPull(db: AgriLogDatabase = getDatabase(), send: ClipSend = apiFetch): Promise<void> {
    try {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        const first = await readOwnerVoice(db);
        if (first.messages.length === 0) return;
        const wanted = [...new Set(first.messages.flatMap(clipIdsOf))];
        for (const farmId of (await db.farms.toCollection().primaryKeys()).map(String)) {
            const view = await readOwnerVoice(db);
            const missing = wanted.filter(id => view.clips.has(id) && !view.keptClips.has(id));
            if (missing.length === 0) break;
            await fetchOwnerClips(db, farmId, missing, send);
        }
        for (const versionId of new Set(first.messages.map(m => m.newVersionId).filter((v): v is string => !!v))) {
            await loadDayCards(versionId).catch(() => undefined);
        }
    } catch {
        // Fire and forget: a failure leaves the words "not on the phone yet" on the card; the next pull or an open screen tries again.
    }
}
