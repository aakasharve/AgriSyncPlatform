/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane RF) — WHERE ▶ MAY BE OFFERED on आढावा. Pure.
 *
 * Two ways to hear a recording, and the page never offers one the person may not use (doctrine P5):
 *   1. 'clip'   — the recording's clip is ON THIS PHONE (the phone it was spoken on): played here, as the result
 *                 screen plays it (`useLogClips`).
 *   2. 'server' — founder D-31's "मूळ आवाज ऐका" (`OriginalVoiceButton`), offered only where the SERVER has said this
 *                 person may hear this record's words. The server decides with ONE rule (`RecordWordsGate`: the
 *                 speaker, the primary owner, or a member holding the owner's grant) for both the original voice and
 *                 the words it sends down with a record (lane F1, review S1). So:
 *                   - a record the server sent its content for (`legacyPartial === false`): his words arrived ⇔ the
 *                     server lets this person hear them;
 *                   - any other record (made on this phone, or an older record kept only as task lines): the first
 *                     two clauses of the same rule, from what the server told this phone — he is the speaker, or
 *                     the server named him the farm's primary owner. The grant is not known here, so it is not
 *                     assumed. The server still has the last word when he presses (unavailable / not yet on the
 *                     server / try again), and the button says so honestly.
 *   A typed entry has nothing to hear ('none'): the page shows the "no recording" note instead.
 */
import type { DailyLog } from '../../../types';
import type { DayRecording } from './dayRecordings';

/** Who is holding this phone, as the server told it. */
export interface Viewer {
    /** Ids that mean "the person holding this phone" (the active operator and the signed-in user). */
    youIds: ReadonlySet<string>;
    /** His role on this farm, as the server sent it (`PrimaryOwner`, …); `null` = not told yet. */
    farmRole: string | null;
    /** The farm on screen. */
    farmId: string | null;
}

export type ListenKind = 'clip' | 'server' | 'none';

const PRIMARY_OWNER = 'PrimaryOwner';

/** The farm the server would look the record up in. */
export const farmOfLog = (log: DailyLog, viewer: Viewer): string | null => log.meta?.farmId || viewer.farmId || null;

/** May "मूळ आवाज ऐका" be offered for the log that carries his words? See the file header. */
export function serverMayPlay(voiceLog: DailyLog, viewer: Viewer): boolean {
    if (!farmOfLog(voiceLog, viewer)) return false;
    if (voiceLog.legacyPartial === false) return !!voiceLog.fullTranscript?.trim();
    const speaker = voiceLog.meta?.createdByOperatorId ?? '';
    return (!!speaker && viewer.youIds.has(speaker)) || viewer.farmRole === PRIMARY_OWNER;
}

/** How this recording can be heard here, if at all. */
export function listenKind(rec: DayRecording, clipOnPhone: boolean, viewer: Viewer): ListenKind {
    if (rec.view.typed) return 'none';
    if (clipOnPhone) return 'clip';
    return serverMayPlay(rec.voiceLog, viewer) ? 'server' : 'none';
}
