/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone tasks P4-P8; contract §5.4, P10) - the honest lines of the farm's setup, in place
 * of "फक्त या फोनवर…" on the pages that now read the farm's set: a change that waits says so under its item; a saved item says nothing (it is on every
 * phone of the farm); a refused change stays visible with its words until he acts on it; a person who may not change the setup reads, and is told who
 * can. The page's font is inherited (Noto Sans Devanagari / DM Sans, `placeUi`).
 */
import React from 'react';
import { AlertTriangle, CloudOff, Lock } from 'lucide-react';
import { Tap } from '../../../shared/components/ui/placeUi';
import type { FarmSetupRefusal } from './farmSetupLocal';
import { farmSetupWords } from './farmSetupWords';

type Lang = { language?: string | null };

export const WaitingLine: React.FC<Lang> = ({ language }) => (
    <p data-testid="setup-waiting" className="m-0 mt-1 flex items-start gap-1.5 text-[13px] font-bold leading-snug text-amber-800">
        <CloudOff size={14} className="mt-0.5 shrink-0" aria-hidden="true" />{farmSetupWords(language).waiting}
    </p>
);

export const PageWaitingLine: React.FC<Lang & { count: number }> = ({ count, language }) => (count > 0 ? (
    <p data-testid="setup-waiting-count" className="m-0 flex items-start gap-2 rounded-2xl bg-amber-50 px-3 py-2 text-[13.5px] font-bold leading-snug text-amber-800 ring-1 ring-amber-200">
        <CloudOff size={17} className="mt-0.5 shrink-0" aria-hidden="true" />{farmSetupWords(language).waitingCount(count)}
    </p>
) : null);

export const ReadOnlyLine: React.FC<Lang> = ({ language }) => (
    <p data-testid="setup-read-only" className="m-0 flex items-start gap-2 rounded-2xl bg-stone-50 px-3 py-2 text-[13.5px] font-bold leading-snug text-stone-700 ring-1 ring-stone-200">
        <Lock size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{farmSetupWords(language).readOnly}
    </p>
);

/** A line said once after a save that could not be queued (busy, too many decimals). */
export const SetupMessage: React.FC<{ text: string | null }> = ({ text }) => (text ? (
    <p data-testid="setup-message" role="status" className="m-0 rounded-xl bg-amber-50 p-2.5 text-[14px] font-extrabold text-amber-900 ring-1 ring-amber-200">{text}</p>
) : null);

/**
 * A refused change: the server's words for its kind, and what he can do. Stale or content: "नवीन माहिती पहा" (close it; the new version stays) and
 * "माझा बदल पुन्हा करा" (close it and open the form with what he typed, on top of the new version). No permission: only "ठीक आहे" - sending it again
 * cannot succeed. Until he acts, the refused change stays here (P10).
 */
export const RefusedBox: React.FC<Lang & { refusal: FarmSetupRefusal; onSeeNew: () => void; onRedo?: () => void }> = ({ refusal, onSeeNew, onRedo, language }) => {
    const w = farmSetupWords(language);
    const canRedo = !!onRedo && (refusal.kind === 'stale' || refusal.kind === 'invalid');
    return (
        <div data-testid="setup-refused" className="mt-1.5 rounded-2xl bg-rose-50 p-2.5 ring-1 ring-rose-200">
            <p className="m-0 flex items-start gap-1.5 text-[13.5px] font-extrabold leading-snug text-rose-900">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />{w.refused[refusal.kind]}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
                {canRedo ? (
                    <>
                        <Tap onClick={onSeeNew} data-testid="setup-see-new" className="min-h-[44px] flex-1 rounded-full bg-white px-3 text-[14px] font-extrabold text-stone-800 ring-1 ring-stone-300">{w.seeNew}</Tap>
                        <Tap onClick={onRedo} data-testid="setup-redo" className="min-h-[44px] flex-1 rounded-full bg-rose-700 px-3 text-[14px] font-extrabold text-white">{w.redo}</Tap>
                    </>
                ) : (
                    <Tap onClick={onSeeNew} data-testid="setup-understood" className="min-h-[44px] flex-1 rounded-full bg-white px-3 text-[14px] font-extrabold text-stone-800 ring-1 ring-stone-300">{w.understood}</Tap>
                )}
            </div>
        </div>
    );
};

/** The words for a save that could not be queued, or null for anything else (which is thrown on). */
export function saveProblemWords(error: unknown, language?: string | null): string | null {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'FarmSetupChangeBusy') return farmSetupWords(language).busy;
    if (code === 'FarmSetupNumberTooFine') return farmSetupWords(language).tooFine;
    return null;
}
