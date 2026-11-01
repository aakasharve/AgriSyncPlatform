/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane RF) — the small pieces every आढावा view of a recording
 * shares, so the plot's day view and the notes say the same thing the same way:
 *   - the ONE status wording ("पक्कं नाही" / "✔ पक्कं केलं"),
 *   - ▶ only where it may be offered (`listenModel.ts`): the clip on this phone, or the server's original voice,
 *   - the photos attached to a log (the old drawer's and feed card's attachments, kept).
 * Built from the result screen's own parts (`DayParts`, `ClipPlayer`) and `OriginalVoiceButton`; nothing copied.
 */
import React, { useState } from 'react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { AttachmentList, useAttachmentRetry } from '../../attachments';
import OriginalVoiceButton from '../../logs/components/originalVoice/OriginalVoiceButton';
import MoneyWordsWithheldCard from '../../logs/components/originalVoice/MoneyWordsWithheldCard';
import ClipPlayer from '../../logs/components/voiceResult/ClipPlayer';
import { reflectCopy, type ReflectCopy } from '../reflectCopy';
import { useLogAttachmentCount } from '../overview/useLogAttachmentCount';
import type { DayRecording } from './dayRecordings';
import type { DayListen } from './useDayListen';

/** This page's words in the person's language. */
export const useReflectCopy = (): ReflectCopy => reflectCopy(useOptionalLanguage()?.language);

/** "पक्कं नाही" / "✔ पक्कं केलं" — the result screen's words, the same on every view of a recording. */
export const StatusChip: React.FC<{ confirmed: boolean; testId?: string }> = ({ confirmed, testId }) => {
    const copy = useReflectCopy();
    return (
        <span data-testid={testId} data-confirmed={confirmed ? 'yes' : 'no'}
            className={`shrink-0 text-[12px] font-extrabold ${confirmed ? 'text-emerald-700' : 'text-stone-600'}`}>
            {confirmed ? copy.confirmed : copy.notConfirmed}
        </span>
    );
};

/** ▶ for this recording, only where `listenModel` allows it; nothing at all otherwise (never a dead button). */
export const ListenControl: React.FC<{ rec: DayRecording; listen: DayListen; big?: boolean; testId: string }> = ({ rec, listen, big, testId }) => {
    // Lane MU-3 fix 1 (F3, D-66): a record that mentions money, not his, not his money — its voice is not offered; the
    // rule line says why (W1), never a dead button.
    if (rec.view.wordsWithheld) return <MoneyWordsWithheldCard testId={`${testId}-withheld`} />;
    const kind = listen.kindOf(rec);
    if (kind === 'clip') {
        const clip = listen.clipOf(rec);
        return clip ? (
            <div className="mt-2" data-testid={`${testId}-listen`} data-listen="clip">
                <ClipPlayer clipKey={clip.id} durationSec={listen.lengthOf(rec)} playing={listen.playing(rec)} progress={listen.progress} big={big}
                    onToggle={() => listen.toggle(rec)} testId={testId} />
            </div>
        ) : null;
    }
    const farmId = kind === 'server' ? listen.farmOf(rec) : null;
    return farmId ? (
        <div data-testid={`${testId}-listen`} data-listen="server">
            <OriginalVoiceButton dailyLogId={rec.voiceLog.id} farmId={farmId} />
        </div>
    ) : null;
};

/** The photos attached to one log: a count that opens the list (the old drawer's "Attachments", in his language). */
export const LogPhotos: React.FC<{ logId: string }> = ({ logId }) => {
    const copy = useReflectCopy();
    const count = useLogAttachmentCount(logId);
    const [open, setOpen] = useState(false);
    const { retryUpload } = useAttachmentRetry();
    if (count <= 0) return null;
    return (
        <div className="mt-2">
            <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} data-testid={`rec-photos-${logId}`}
                className="inline-flex min-h-[36px] items-center rounded-md border border-blue-200 bg-blue-50 px-2 text-[12.5px] font-bold text-blue-800">
                {copy.photos(count)}
            </button>
            {open && <div className="mt-1"><AttachmentList linkedEntityId={logId} compact onRetry={retryUpload} /></div>}
        </div>
    );
};
