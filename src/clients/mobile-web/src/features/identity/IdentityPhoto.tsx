/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S6) - his photo circle on "माझी ओळख" and its sheet (V2-A: "फोटो काढा",
 * "गॅलरीतून निवडा", "फोटो काढून टाका"). His own face only: the circle shows the face the SERVER names on his card (`photo`), else the first letter of
 * his own name, never someone else's face.
 *
 * A photo is shrunk on the phone first (longest side 512 px, JPEG, at most 512 KB, camera data dropped: `shrinkPicture`) and sent as raw bytes to
 * `PUT /shramsafal/pictures/person` (the existing lane SCH-ID door). Offline it says so and keeps nothing (the existing door's rule).
 *
 * The two file inputs are visually hidden and opened by a button's click; they have no focus handler (the real-browser focus bug of an earlier lane).
 * "फोटो काढा" asks for the camera (`capture="user"`); whether the APK's WebView opens the camera directly is UNVERIFIED (contract U10).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Trash2, X } from 'lucide-react';
import { apiFetch } from '../../infrastructure/api/apiFetch';
import { useBackDismiss } from '../../core/navigation/useBackDismiss';
import { putPersonPicture, removePersonPicture } from '../scheduler/pictures/schedulePictureApi';
import { shrinkPicture } from '../scheduler/pictures/shrinkPicture';
import { pictureWords } from '../scheduler/pictures/schedulePictureCopy';
import type { IdentityWords } from './identityWords';

const urls = new Map<string, string>();

/** The face file the server names (`/shramsafal/pictures/{id}`, signed in) as an object URL, kept for this app run; null until it is here. */
export function useOwnPhotoUrl(photo: { pictureId: string; sha256: string } | null | undefined): string | null {
    const sha = photo?.sha256 ?? null;
    const id = photo?.pictureId ?? null;
    const [url, setUrl] = useState<string | null>(sha ? urls.get(sha) ?? null : null);
    useEffect(() => {
        if (!id || !sha) { setUrl(null); return undefined; }
        const held = urls.get(sha);
        if (held) { setUrl(held); return undefined; }
        let alive = true;
        void (async () => {
            try {
                const response = await apiFetch(`/shramsafal/pictures/${encodeURIComponent(id)}`, { method: 'GET' });
                if (!response.ok) return;
                const blob = await response.blob();
                if (!/^image\/(jpeg|png|webp)$/.test(blob.type) || blob.size === 0) return;
                const made = URL.createObjectURL(blob);
                urls.set(sha, made);
                if (alive) setUrl(made);
            } catch {
                /* no network: the letter stays */
            }
        })();
        return () => { alive = false; };
    }, [id, sha]);
    return id && sha ? url : null;
}

/** The first letter of a name as it is written (a Marathi letter with its vowel sign: "पूर्वेश" -> "पू"). */
export function initialOf(name: string): string {
    const text = name.trim();
    if (!text) return '';
    const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: 'grapheme' }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
    if (Seg) {
        for (const part of new Seg('mr', { granularity: 'grapheme' }).segment(text)) return part.segment.toUpperCase();
    }
    const m = text.match(/^.[ऀ-ःऺ-ॏॕ-ॗॢॣ]*/u);
    return (m?.[0] ?? text[0]).toUpperCase();
}

export const IdentityPhoto: React.FC<{
    name: string;
    photo: { pictureId: string; sha256: string } | null | undefined;
    words: IdentityWords;
    language: 'mr' | 'en';
    /** After a change: the card is read again so the server's new pointer is shown. */
    onChanged: () => void;
}> = ({ name, photo, words, language, onChanged }) => {
    const url = useOwnPhotoUrl(photo);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ tone: 'ok' | 'problem'; text: string } | null>(null);
    const camera = useRef<HTMLInputElement | null>(null);
    const gallery = useRef<HTMLInputElement | null>(null);
    const problems = pictureWords(language).problem;
    useBackDismiss(open, () => setOpen(false));

    const choose = async (file: File) => {
        setBusy(true);
        setMessage(null);
        try {
            if (typeof navigator !== 'undefined' && navigator.onLine === false) { setMessage({ tone: 'problem', text: problems.offline }); return; }
            const shrunk = await shrinkPicture(file);
            if (!shrunk.ok) { setMessage({ tone: 'problem', text: problems[shrunk.reason] }); return; }
            const r = await putPersonPicture(shrunk.blob);
            if (r.ok) { setMessage({ tone: 'ok', text: words.photoSaved }); onChanged(); } else setMessage({ tone: 'problem', text: problems[r.reason] });
        } catch {
            setMessage({ tone: 'problem', text: problems.failed });
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        setBusy(true);
        setMessage(null);
        try {
            const r = await removePersonPicture();
            if (r.ok) { setMessage({ tone: 'ok', text: words.photoRemoved }); onChanged(); } else setMessage({ tone: 'problem', text: problems[r.reason] });
        } finally {
            setBusy(false);
        }
    };

    const fileInput = (ref: React.MutableRefObject<HTMLInputElement | null>, testId: string, capture?: boolean) => (
        <input ref={ref} type="file" accept="image/*" {...(capture ? { capture: 'user' as const } : {})} className="sr-only" tabIndex={-1} aria-hidden="true"
            data-testid={testId}
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void choose(f); }} />
    );
    const row = (icon: React.ReactNode, label: string, onClick: () => void, testId: string) => (
        <button type="button" disabled={busy} onClick={onClick} data-testid={testId}
            className="flex min-h-[52px] w-full items-center gap-3 rounded-2xl border border-stone-200 bg-white px-3 text-left text-[16px] font-extrabold text-stone-900 disabled:opacity-50">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-emerald-100 text-emerald-800">{icon}</span>{label}
        </button>
    );

    return (
        <>
            <button type="button" onClick={() => { setMessage(null); setOpen(true); }} aria-label={words.photoAria} data-testid="my-identity-photo"
                className="relative grid h-[72px] w-[72px] shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-100 to-emerald-200 shadow">
                {url
                    ? <img src={url} alt="" className="h-full w-full rounded-full object-cover" data-testid="my-identity-photo-img" />
                    : <span className="text-[26px] font-extrabold text-emerald-800" data-testid="my-identity-initial">{initialOf(name)}</span>}
                <span className="absolute -bottom-0.5 -right-0.5 grid h-7 w-7 place-items-center rounded-full bg-emerald-600 text-white ring-2 ring-white" aria-hidden="true">
                    <Camera size={14} strokeWidth={2.4} />
                </span>
            </button>
            {open && (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/60 px-3 py-4" onClick={() => setOpen(false)} data-testid="my-photo-sheet">
                    <div className="relative w-full max-w-md rounded-3xl bg-white p-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <button type="button" onClick={() => setOpen(false)} aria-label={words.close} data-testid="my-photo-close"
                            className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-stone-100 text-stone-600">
                            <X size={18} aria-hidden="true" />
                        </button>
                        <p className="m-0 pr-12 text-[20px] font-black text-stone-900">{words.photoSheetTitle}</p>
                        <p className="m-0 mt-1 text-[12.5px] font-semibold leading-snug text-stone-600">{words.photoLine}</p>
                        {fileInput(camera, 'my-photo-file-camera', true)}
                        {fileInput(gallery, 'my-photo-file-gallery')}
                        <div className="mt-3 flex flex-col gap-2">
                            {row(<Camera size={20} aria-hidden="true" />, words.takePhoto, () => camera.current?.click(), 'my-photo-take')}
                            {row(<ImagePlus size={20} aria-hidden="true" />, words.fromGallery, () => gallery.current?.click(), 'my-photo-gallery')}
                            {photo && row(<Trash2 size={20} aria-hidden="true" />, words.removePhoto, () => { void remove(); }, 'my-photo-remove')}
                        </div>
                        <p role="status" aria-live="polite" data-testid="my-photo-status"
                            className={`m-0 mt-2 text-[14px] font-extrabold ${message?.tone === 'problem' ? 'text-amber-900' : 'text-emerald-800'}`}>
                            {busy ? pictureWords(language).working : message?.text ?? ''}
                        </p>
                    </div>
                </div>
            )}
        </>
    );
};
