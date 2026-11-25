// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b, CTO gate; P10 offline) - right after a pull lands (outside its transaction), everything a farmer needs to hear
// and see the schedule owner's voice in the field is kept on the phone with NO screen open:
//   - the clips of every owner's message this phone holds (and a look's follow-ups). The clip route needs a farm: tried farm by farm (a farm whose plots do not follow that
//     schedule is answered 404 and passed over). A kept clip is never fetched again.
//   - the day cards the messages sit on (and every followed schedule's): the version a message is about and the checked new version a change points at, only where the
//     phone holds no copy yet (`keepDayCardsForOffline`). A clip with no card to play it on is no use offline (found by the real-app drive).
// Never throws; does nothing with no signal.
import { apiFetch } from '../../../infrastructure/api/apiFetch';
import type { AgriLogDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { keepDayCardsForOffline } from '../dayCards/dayCardsOfflineKeep';
import { clipIdsOf, fetchOwnerClips, readOwnerVoice, type ClipSend } from './ownerVoiceStore';

export async function prefetchOwnerVoiceAfterPull(db: AgriLogDatabase = getDatabase(), send: ClipSend = apiFetch): Promise<void> {
    try {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        const first = await readOwnerVoice(db);
        const wanted = [...new Set(first.messages.flatMap(clipIdsOf))];
        if (wanted.length > 0) {
            for (const farmId of (await db.farms.toCollection().primaryKeys()).map(String)) {
                const view = await readOwnerVoice(db);
                const missing = wanted.filter(id => view.clips.has(id) && !view.keptClips.has(id));
                if (missing.length === 0) break;
                await fetchOwnerClips(db, farmId, missing, send);
            }
        }
        const versions = first.messages.flatMap(m => (m.newVersionId ? [m.scheduleVersionId, m.newVersionId] : [m.scheduleVersionId]));
        await keepDayCardsForOffline(versions, db, send);
    } catch {
        // Fire and forget: a failure leaves the words "not on the phone yet" on the card; the next pull or an open screen tries again.
    }
}
