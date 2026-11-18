/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-P; founder D-146, D-148 default 2: nothing is shown until the owner adds it) - the
 * OWNER'S small action on the owner bar of his OWN schedule: "फोटो लावा" opens two choices, "माझा फोटो" (his face, on all his schedules) and "या शेड्यूलचं
 * चित्र" (this schedule only). Each picks a photo from the camera or the gallery (the phone's own chooser), shrinks it on the phone (`shrinkPicture`: JPEG,
 * longest side 512 px, at most 512 KB), and sends the bytes in a direct REST call (`schedulePictureApi`). "फोटो काढा" removes the one that is showing.
 *
 * Only the person the schedule belongs to sees it (`ownerUserId` is the signed-in person); a worker, a co-owner, a stranger and every outside schedule see
 * nothing. NOT a sync mutation: no outbox row. Offline it says so and keeps nothing. After a change it asks for a sync, so the new picture comes down
 * the way every other picture does (the pull names it, the downloader fetches it).
 */
import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Trash2, X } from 'lucide-react';
import type { CropScheduleTemplate, SchedulePictureKind } from '../scheduler.types';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { getSessionUserId } from '../../../infrastructure/storage/AuthTokenStore';
import { pictureWords } from './schedulePictureCopy';
import {
    putPersonPicture, putSchedulePicture, removePersonPicture, removeSchedulePicture,
    type PictureCallResult,
} from './schedulePictureApi';
import { shrinkPicture, type ShrinkEngine } from './shrinkPicture';

type Mine = Extract<SchedulePictureKind, 'PERSON' | 'SCHEDULE'>;

export interface PictureActions {
    putPerson(bytes: Blob): Promise<PictureCallResult>;
    removePerson(): Promise<PictureCallResult>;
    putSchedule(rootId: string, bytes: Blob): Promise<PictureCallResult>;
    removeSchedule(rootId: string): Promise<PictureCallResult>;
}

const REAL_ACTIONS: PictureActions = {
    putPerson: bytes => putPersonPicture(bytes),
    removePerson: () => removePersonPicture(),
    putSchedule: (rootId, bytes) => putSchedulePicture(rootId, bytes),
    removeSchedule: rootId => removeSchedulePicture(rootId),
};

/** True when this schedule belongs to the signed-in person (the server's `ownerUserId`; an outside schedule has none). */
export function isOwnersSchedule(template: Pick<CropScheduleTemplate, 'ownerUserId'>, currentUserId: string | null | undefined): boolean {
    return !!template.ownerUserId && !!currentUserId && template.ownerUserId.toLowerCase() === currentUserId.toLowerCase();
}

const askForSync = () => {
    void import('../../../infrastructure/sync/BackgroundSyncWorker').then(m => m.backgroundSyncWorker.triggerNow()).catch(() => undefined);
};

type Message = { tone: 'ok' | 'problem'; text: string } | null;

export const SchedulePictureChooser: React.FC<{
    template: Pick<CropScheduleTemplate, 'id' | 'ownerUserId' | 'pictureKind'>;
    /** The signed-in person; default: the session's. Injected in tests. */
    currentUserId?: string | null;
    actions?: PictureActions;
    engine?: ShrinkEngine;
    /** Called after a picture was set or removed (default: ask for a sync). */
    onChanged?: () => void;
}> = ({ template, currentUserId, actions = REAL_ACTIONS, engine, onChanged = askForSync }) => {
    const language = useOptionalLanguage()?.language === 'en' ? 'en' : 'mr';
    const words = pictureWords(language);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState<Mine | null>(null);
    const [message, setMessage] = useState<Message>(null);
    const inputs = useRef<Partial<Record<Mine, HTMLInputElement | null>>>({});
    const alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

    const me = currentUserId === undefined ? getSessionUserId() : currentUserId;
    if (!isOwnersSchedule(template, me)) return null;

    const showing: Mine | null = template.pictureKind === 'PERSON' || template.pictureKind === 'SCHEDULE' ? template.pictureKind : null;
    const say = (next: Message) => { if (alive.current) setMessage(next); };
    const finish = (result: PictureCallResult, okText: string) => {
        if (result.ok) { say({ tone: 'ok', text: okText }); onChanged(); } else say({ tone: 'problem', text: words.problem[result.reason] });
    };

    const choose = async (kind: Mine, file: File) => {
        setBusy(kind);
        say(null);
        try {
            if (typeof navigator !== 'undefined' && navigator.onLine === false) { say({ tone: 'problem', text: words.problem.offline }); return; }
            const shrunk = await shrinkPicture(file, engine);
            if (!shrunk.ok) { say({ tone: 'problem', text: words.problem[shrunk.reason] }); return; }
            finish(kind === 'PERSON' ? await actions.putPerson(shrunk.blob) : await actions.putSchedule(template.id, shrunk.blob), words.saved);
        } catch {
            say({ tone: 'problem', text: words.problem.failed });
        } finally {
            if (alive.current) setBusy(null);
        }
    };

    const remove = async (kind: Mine) => {
        setBusy(kind);
        say(null);
        try {
            finish(kind === 'PERSON' ? await actions.removePerson() : await actions.removeSchedule(template.id), words.removed);
        } catch {
            say({ tone: 'problem', text: words.problem.failed });
        } finally {
            if (alive.current) setBusy(null);
        }
    };

    const rows: ReadonlyArray<{ kind: Mine; label: string; hint: string }> = [
        { kind: 'PERSON', label: words.mine, hint: words.mineHint },
        { kind: 'SCHEDULE', label: words.schedule, hint: words.scheduleHint },
    ];
    const buttonClass = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full border-2 px-3 text-[14.5px] font-extrabold active:scale-95 disabled:opacity-50';

    if (!open) {
        return (
            <button type="button" onClick={() => setOpen(true)} data-testid="picture-open" className={`mt-2 ${buttonClass} border-emerald-600 bg-white text-emerald-800`}>
                <ImagePlus size={18} aria-hidden="true" />{showing ? words.openChange : words.open}
            </button>
        );
    }

    return (
        <div className="mt-2 space-y-2 rounded-2xl border border-stone-200 bg-stone-50 p-2.5" data-testid="picture-panel" role="group" aria-label={words.sheetTitle}>
            <div className="flex items-center gap-2">
                <p className="m-0 min-w-0 flex-1 text-[15px] font-black text-stone-900">{words.sheetTitle}</p>
                <button type="button" onClick={() => setOpen(false)} data-testid="picture-close" aria-label={words.close}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-stone-700 ring-1 ring-stone-300 active:scale-95">
                    <X size={20} aria-hidden="true" />
                </button>
            </div>
            <p className="m-0 text-[13px] font-bold leading-snug text-stone-600" data-testid="picture-notice">{words.notice}</p>
            {rows.map(row => (
                <div key={row.kind} className="space-y-1.5 rounded-xl bg-white p-2 ring-1 ring-stone-200" data-testid={`picture-row-${row.kind}`}>
                    <p className="m-0 text-[15px] font-extrabold text-stone-900">{row.label}</p>
                    <p className="m-0 text-[13px] font-bold leading-snug text-stone-600">{row.hint}</p>
                    <div className="flex flex-wrap gap-2">
                        <input ref={el => { inputs.current[row.kind] = el; }} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true"
                            data-testid={`picture-file-${row.kind}`}
                            onChange={e => {
                                const file = e.target.files?.[0];
                                e.target.value = '';
                                if (file) void choose(row.kind, file);
                            }} />
                        <button type="button" disabled={busy !== null} onClick={() => inputs.current[row.kind]?.click()} data-testid={`picture-choose-${row.kind}`}
                            className={`${buttonClass} border-[#1448E6] bg-white text-[#1448E6]`}>
                            <ImagePlus size={18} aria-hidden="true" />{showing === row.kind ? words.change : words.choose}
                        </button>
                        {showing === row.kind && (
                            <button type="button" disabled={busy !== null} onClick={() => void remove(row.kind)} data-testid={`picture-remove-${row.kind}`}
                                className={`${buttonClass} border-stone-400 bg-white text-stone-800`}>
                                <Trash2 size={18} aria-hidden="true" />{words.remove}
                            </button>
                        )}
                    </div>
                </div>
            ))}
            <p role="status" aria-live="polite" data-testid="picture-status" data-tone={busy ? 'busy' : message?.tone ?? ''}
                className={`m-0 text-[14px] font-extrabold leading-snug ${busy ? 'text-stone-700' : message?.tone === 'problem' ? 'rounded-xl bg-amber-50 p-2 text-amber-900' : 'text-emerald-800'}`}>
                {busy ? words.working : message?.text ?? ''}
            </p>
        </div>
    );
};

export default SchedulePictureChooser;
