// spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-P, founder D-146 / D-148) - the row of the Dexie `schedulePictures` store
// (schema v29), kept apart from DexieDatabase.types.ts (mobile-web 800-line cap).
//
// One row = one picture file this phone holds for a schedule's maker, as the server sent it to THIS person: a person's own photo, a schedule's
// own picture, or an institution's logo. It is personal data: it lives only in this person's own database on this phone, is never logged, and is
// never put in a web address. The key is the server's picture id; `sha256` is the hash of the bytes held (the pull's `pictureSha256` is compared
// with it, and the screen shows the file only while the two agree).

import type { SchedulePictureKind } from '../../features/scheduler/scheduler.types';

export interface SchedulePictureRow {
    pictureId: string;
    /** Lower-case hex SHA-256 of `blob`'s bytes, as the server named it. */
    sha256: string;
    kind: SchedulePictureKind;
    blob: Blob;
    /** ISO time the file was stored. */
    fetchedAt: string;
}
