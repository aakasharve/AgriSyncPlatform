/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The review card's parts (lane L4b split them out of `ReviewSheet.tsx` for the 800-line gate; spec plr-d10 I28).
 *
 *  - `ReviewFacts` (Task 20, labour-v2-release-1): the four facts an approval is judged on — how many people, what
 *    work, which plot, how much money — ALWAYS all four; an unknown one is "—", never a fabricated 0 (P4). `Farm`
 *    scope is the farmer's own संपूर्ण शेत assertion, a fact.
 *  - `ChangedNotice` (founder D-46 §3, D-40 "approval applies to the exact version shown"): the server refused his
 *    मंजूर because the record changed after he saw it; this says so with the reason and what changed.
 *  - `DisputeReasonPanel` (D-40 §3): a शंका needs his reason, spoken or typed; the send stays off until there is one.
 *  - `BulkConfirmPanel` (D-40 §4): the number is shown before a bulk मंजूर goes.
 */
import React, { useState } from 'react';
import { Users, Sprout, MapPin, Wallet, Mic, AlertTriangle } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import type { ReviewItem } from '../labour.types';
import { inr } from '../labour.types';
import type { Language } from '../../../i18n/language';
import { resolveOversightString } from '../../../i18n/oversightTranslations';
import { DeviceSpeechRecognizer } from '../../../infrastructure/voice/DeviceSpeechRecognizer';
import { numberIn, type ApprovalWords } from '../../approval/approvalWords';
import type { SeenFacts } from '../../approval/approvalQueue';

export type ConfirmKind = 'approve' | 'query' | 'approveAll';

export const ConfirmOverlay: React.FC<{ kind: ConfirmKind; words: ApprovalWords }> = ({ kind, words }) => (
    <div className="review-card-overlay absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-2xl bg-emerald-500 text-white">
        <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7" aria-hidden="true">
            <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="review-checkmark-path" />
        </svg>
        <span className="text-[11px] font-extrabold">{kind === 'query' ? words.disputedMark : words.approvedMark}</span>
    </div>
);

const Fact: React.FC<{ testId: string; icon: React.ReactNode; value: string; known: boolean }> = ({ testId, icon, value, known }) => (
    <div data-testid={testId} className={`flex min-w-0 items-center gap-2 rounded-xl px-2.5 py-2 ${known ? 'bg-stone-100 text-stone-800' : 'bg-stone-50 text-stone-400'}`}>
        <span className={`flex-shrink-0 ${known ? 'text-stone-500' : 'text-stone-300'}`}>{icon}</span>
        <span className={`truncate text-[16px] ${known ? 'font-bold' : 'font-semibold'}`}>{value}</span>
    </div>
);

/** The plot as the card states it: संपूर्ण शेत (a stated scope), a plot name, or nothing known. */
export function plotLabelOf(item: ReviewItem, language: Language): string | null {
    return item.plotScope === 'Farm' ? resolveOversightString(language, 'entireFarmLabel') : (item.plot || null);
}

export const ReviewFacts: React.FC<{ item: ReviewItem; words: ApprovalWords; language: Language }> = ({ item, words, language }) => {
    const { count, task, amount } = item.points;
    const plotLabel = plotLabelOf(item, language);
    const unknown = words.unknownMark;
    return (
        <div className="grid grid-cols-2 gap-1.5">
            <Fact testId={`review-fact-count-${item.id}`} icon={<Users size={16} />} known={count != null}
                value={`${count != null ? numberIn(count, language) : unknown} ${words.peopleUnit}`} />
            <Fact testId={`review-fact-task-${item.id}`} icon={<Sprout size={16} />} known={!!task} value={task || unknown} />
            <Fact testId={`review-fact-plot-${item.id}`} icon={<MapPin size={16} />} known={plotLabel != null} value={plotLabel ?? unknown} />
            <Fact testId={`review-fact-amount-${item.id}`} icon={<Wallet size={16} />} known={amount != null} value={amount != null ? inr(amount) : unknown} />
        </div>
    );
};

/** "What changed": each of the four facts whose value moved between what he saw and the new version. */
export function changedFactLines(seen: SeenFacts | null, item: ReviewItem, words: ApprovalWords, language: Language): string[] {
    if (!seen) return [];
    const show = (v: string | number | null | undefined, money = false): string =>
        v == null || v === '' ? words.unknownMark : typeof v === 'number' ? (money ? inr(v) : numberIn(v, language)) : v;
    const plotNow = item.plotScope === 'Farm' ? 'Farm' : (item.plot || null);
    const plotText = (p: string | null) => (p === 'Farm' ? resolveOversightString(language, 'entireFarmLabel') : p);
    const lines: string[] = [];
    if ((seen.count ?? null) !== (item.points.count ?? null)) lines.push(`${words.factPeople}: ${show(seen.count)} → ${show(item.points.count)}`);
    if ((seen.task ?? null) !== (item.points.task || null)) lines.push(`${words.factWork}: ${show(seen.task)} → ${show(item.points.task)}`);
    if ((seen.plot ?? null) !== plotNow) lines.push(`${words.factPlot}: ${show(plotText(seen.plot))} → ${show(plotText(plotNow))}`);
    if ((seen.amount ?? null) !== (item.points.amount ?? null)) lines.push(`${words.factCost}: ${show(seen.amount, true)} → ${show(item.points.amount, true)}`);
    return lines;
}

export const ChangedNotice: React.FC<{ item: ReviewItem; seen: SeenFacts | null; words: ApprovalWords; language: Language }> = ({ item, seen, words, language }) => {
    const lines = changedFactLines(seen, item, words, language);
    return (
        <div data-testid={`review-changed-${item.id}`} role="status" className="mb-2.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5">
            <p className="flex items-center gap-2 text-[16px] font-extrabold text-amber-900">
                <AlertTriangle size={18} aria-hidden="true" className="shrink-0" /> {words.changedTitle}
            </p>
            <p className="mt-1 text-[14px] leading-snug text-amber-900">{words.changedReason}</p>
            {lines.length > 0 && (
                <div className="mt-1.5" data-testid={`review-changed-lines-${item.id}`}>
                    <p className="text-[13px] font-bold text-amber-800">{words.whatChanged}</p>
                    {lines.map((l) => <p key={l} className="text-[14px] font-semibold text-stone-800">{l}</p>)}
                </div>
            )}
        </div>
    );
};

const speechLanguage = (language: Language) => (language === 'en' ? 'en-IN' : 'mr-IN');

export const DisputeReasonPanel: React.FC<{
    itemId: string;
    words: ApprovalWords;
    language: Language;
    onSend: (reason: string) => void;
    onCancel: () => void;
}> = ({ itemId, words, language, onSend, onCancel }) => {
    const [reason, setReason] = useState('');
    const [listening, setListening] = useState(false);
    const [micFailed, setMicFailed] = useState(false);
    // The phone's own speech recogniser only exists in the installed app; on the web there is no mic button at all
    // (a button that cannot work would be a painted door, P5). Typing — including the keyboard's voice typing — works.
    const canSpeak = Capacitor.isNativePlatform();
    const speak = async () => {
        setListening(true);
        setMicFailed(false);
        const result = await new DeviceSpeechRecognizer().transcribe({ language: speechLanguage(language) });
        setListening(false);
        if ('transcript' in result) setReason((r) => (r ? `${r} ${result.transcript}` : result.transcript));
        else setMicFailed(true);
    };
    const trimmed = reason.trim();
    return (
        <div data-testid={`review-dispute-panel-${itemId}`} className="mt-3 rounded-xl border-2 border-stone-200 bg-stone-50 p-3">
            <label htmlFor={`review-reason-${itemId}`} className="block text-[16px] font-bold text-stone-800">{words.reasonPrompt}</label>
            <textarea id={`review-reason-${itemId}`} data-testid={`review-reason-${itemId}`} value={reason} rows={2}
                onChange={(e) => setReason(e.target.value)} placeholder={words.reasonPlaceholder}
                className="mt-2 w-full rounded-lg border border-stone-300 bg-white p-2.5 text-[17px] text-stone-900" />
            {micFailed && <p className="mt-1 text-[14px] font-semibold text-amber-800">{words.reasonNoMic}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
                {canSpeak && (
                    <button type="button" data-testid={`review-reason-speak-${itemId}`} disabled={listening} onClick={() => { void speak(); }}
                        className="flex min-h-[52px] items-center gap-2 rounded-xl border-2 border-emerald-600 bg-white px-3.5 text-[17px] font-bold text-emerald-800 disabled:opacity-60">
                        <Mic size={20} aria-hidden="true" /> {listening ? words.reasonListening : words.reasonSpeak}
                    </button>
                )}
                <button type="button" data-testid={`review-reason-send-${itemId}`} disabled={trimmed.length === 0} onClick={() => onSend(trimmed)}
                    className="flex min-h-[52px] flex-1 items-center justify-center rounded-xl bg-stone-700 px-3.5 text-[17px] font-extrabold text-white disabled:opacity-40">
                    {words.reasonSend}
                </button>
                <button type="button" data-testid={`review-reason-cancel-${itemId}`} onClick={onCancel}
                    className="flex min-h-[52px] items-center rounded-xl border-2 border-stone-200 bg-white px-3.5 text-[17px] font-bold text-stone-600">
                    {words.cancel}
                </button>
            </div>
        </div>
    );
};

export const BulkConfirmPanel: React.FC<{ count: number; words: ApprovalWords; onYes: () => void; onNo: () => void }> = ({ count, words, onYes, onNo }) => (
    <div data-testid="review-bulk-confirm" role="dialog" className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-3.5">
        <p className="text-[19px] font-extrabold text-stone-900">{words.confirmSelected(count)}</p>
        <div className="mt-3 flex gap-3">
            <button type="button" data-testid="review-bulk-yes" onClick={onYes}
                className="flex min-h-[56px] flex-1 items-center justify-center rounded-xl bg-emerald-600 text-[18px] font-extrabold text-white">{words.confirmYes}</button>
            <button type="button" data-testid="review-bulk-no" onClick={onNo}
                className="flex min-h-[56px] w-[112px] items-center justify-center rounded-xl border-2 border-stone-200 bg-white text-[18px] font-bold text-stone-600">{words.confirmNo}</button>
        </div>
    </div>
);
