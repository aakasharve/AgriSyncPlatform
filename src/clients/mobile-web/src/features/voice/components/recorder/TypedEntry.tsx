/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I12, LP-06) — the quiet "type instead" way in.
 *
 * Founder 2026-10-24 (preview `TypedLog.tsx`): when he cannot speak he can TYPE what happened (or use
 * the voice key on the phone's own keyboard). It sits quietly under the big mic — one low line — and
 * the sheet says when and how to use it. Whatever is entered this way is marked "लिहिलेलं" wherever it
 * appears in this flow, and has no player, because there is no voice recording behind it.
 *
 * REAL, not a preview: the words he types go to the SAME `onTextCaptured` the old type box used
 * (`useVoiceRecorder.handleTextReady` -> the same parse and review). `onOpenForm` (optional) opens the
 * real hand-filled form (the old "हाताने" mode), which also works with no network.
 *
 * Every Marathi string here is PROPOSED except the tag word "लिहिलेलं".
 */
import React, { useState } from 'react';
import { Keyboard, X } from 'lucide-react';
import { PHONE_COLUMN } from '../../../logs/components/phoneColumn';
import { useBackDismiss } from '../../../../core/navigation/useBackDismiss';

const SANS = "'Noto Sans Devanagari', sans-serif";

export const TYPED_WORDS = {
    /** Founder 2026-10-24: typed entries are marked with this word everywhere. */
    tag: 'लिहिलेलं',
    // PROPOSED (Marathi) — every string below.
    link: 'बोलता येत नसेल तर इथे लिहा',
    title: 'लिहून सांगा',
    whenLabel: 'कधी?',
    when: 'फक्त अडचणीत वापरा: बोलता येत नसेल किंवा आजूबाजूला खूप आवाज असेल तेव्हा.',
    howLabel: 'कसं?',
    how: 'इथे बोटांनी लिहा. किंवा फोनच्या कीबोर्डवरचा माइक दाबून बोला: तो तुमचं बोलणं अक्षरांत लिहून देईल.',
    note: 'यात तुमचा आवाज रेकॉर्ड होत नाही. म्हणून पुढे जिथे जिथे हे दिसेल, तिथे "लिहिलेलं" असं लिहिलेलं असेल.',
    placeholder: 'आज काय काय केलं ते इथे लिहा…',
    send: 'साथीला पाठवा',
    close: 'बंद करा',
    noAudio: 'आवाज रेकॉर्डिंग नाही. हे लिहून सांगितलेलं आहे.',
    form: 'किंवा फॉर्ममध्ये स्वतः भरा',
} as const;

/** Fewer letters than this is not an entry yet. */
export const TYPED_MIN_CHARS = 3;

/** "लिहिलेलं": shown wherever a typed entry appears. */
export const TypedTag: React.FC<{ testId?: string }> = ({ testId = 'typed-tag' }) => (
    <span data-testid={testId} className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-400 bg-amber-50 px-2.5 py-0.5 text-[13px] font-extrabold text-amber-900" style={{ fontFamily: SANS }}>
        <Keyboard size={13} aria-hidden="true" />{TYPED_WORDS.tag}
    </span>
);

/** Stands where a player would be: there is no recording to play. */
export const TypedNote: React.FC = () => (
    <div data-testid="typed-note" className="flex items-center gap-2.5 rounded-2xl border border-amber-300 bg-amber-50 p-2.5" style={{ fontFamily: SANS }}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-500 text-white"><Keyboard size={20} aria-hidden="true" /></span>
        <span className="text-[15px] font-bold leading-snug text-amber-950">{TYPED_WORDS.noAudio}</span>
    </div>
);

/** The quiet one-line way in, under the big mic. `strong` when the mic is refused: then it is THE way in. */
export const TypedLink: React.FC<{ onClick: () => void; strong?: boolean }> = ({ onClick, strong }) => (
    <button type="button" onClick={onClick} data-testid="typed-link"
        className={`mx-auto mt-1 flex min-h-[48px] items-center gap-1.5 rounded-full px-4 text-[15px] font-bold active:opacity-100 ${strong ? 'border-2 border-emerald-600 bg-white text-emerald-800 opacity-100' : 'text-stone-600 opacity-75'}`}
        style={{ fontFamily: SANS }}>
        <Keyboard size={18} aria-hidden="true" />{TYPED_WORDS.link}
    </button>
);

/** A bottom sheet in the phone column: when to use it, how, the box to type in, and (optional) the hand-filled form. */
export const TypedSheet: React.FC<{ onSend: (text: string) => void; onClose: () => void; onOpenForm?: () => void }> = ({ onSend, onClose, onOpenForm }) => {
    const [text, setText] = useState('');
    const ready = text.trim().length >= TYPED_MIN_CHARS;
    useBackDismiss(true, onClose);
    return (
        <div className="fixed inset-0 z-[66] flex items-end justify-center bg-black/45" onClick={onClose} data-testid="typed-sheet" style={{ fontFamily: SANS }}>
            <div className={`max-h-[92%] overflow-y-auto rounded-t-[28px] bg-white p-4 pb-6 shadow-2xl ${PHONE_COLUMN}`} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={TYPED_WORDS.title}>
                <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="m-0 flex items-center gap-2 text-[20px] font-extrabold text-stone-900">{TYPED_WORDS.title}<TypedTag testId="typed-sheet-tag" /></h3>
                    <button type="button" onClick={onClose} aria-label={TYPED_WORDS.close} data-testid="typed-close" className="grid h-12 w-12 place-items-center rounded-full bg-stone-100 text-stone-800"><X size={22} /></button>
                </div>
                <div className="mb-3 space-y-1 rounded-2xl border border-stone-200 bg-stone-50 p-3 text-[15px] font-semibold leading-snug text-stone-800" data-testid="typed-help">
                    <p className="m-0"><b>{TYPED_WORDS.whenLabel}</b> {TYPED_WORDS.when}</p>
                    <p className="m-0"><b>{TYPED_WORDS.howLabel}</b> {TYPED_WORDS.how}</p>
                    <p className="m-0 text-amber-900">{TYPED_WORDS.note}</p>
                </div>
                <TypedNote />
                <textarea value={text} onChange={e => setText(e.target.value)} rows={4} data-testid="typed-input" placeholder={TYPED_WORDS.placeholder}
                    className="mt-3 w-full resize-none rounded-2xl border-2 border-stone-300 bg-white p-3 text-[18px] leading-relaxed text-stone-900 outline-none focus:border-emerald-600" />
                <button type="button" disabled={!ready} onClick={() => onSend(text.trim())} data-testid="typed-send"
                    className="mt-3 min-h-[56px] w-full rounded-2xl bg-emerald-700 text-[18px] font-extrabold text-white disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500 active:scale-[0.98]">
                    {TYPED_WORDS.send}
                </button>
                {onOpenForm && (
                    <button type="button" onClick={onOpenForm} data-testid="typed-open-form"
                        className="mt-2 min-h-[48px] w-full rounded-2xl text-[15px] font-bold text-stone-600 underline-offset-4 active:underline">
                        {TYPED_WORDS.form}
                    </button>
                )}
            </div>
        </div>
    );
};
