/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane MIC-1) — the frame of the ONE mic: full screen, over the
 * screen he started on (which stays where it was, scroll and all). Inside: why he is speaking (one band), where (when
 * known), and THE log recorder — or, once he has spoken, THE waiting screen. Presentational; `SpeakHost` fills it.
 */
import React from 'react';
import { ArrowLeft, MapPin, Mic } from 'lucide-react';
import { PHONE_COLUMN } from '../../features/logs/components/phoneColumn';
import type { SpeakBand } from './speakWords';

const SANS = "'Noto Sans Devanagari', sans-serif";

export interface SpeakScreenProps {
    purpose: string;
    band: SpeakBand;
    backLabel: string;
    /** Where his words go (known place); absent while he still picks it. */
    placeLabel?: string;
    /** He has spoken: the waiting screen stands alone. */
    processing: boolean;
    processingNode: React.ReactNode;
    /** No back while the mic listens (the recorder's own cancel is the way out), nor while he picks (the picker's own back). */
    showBack: boolean;
    onBack: () => void;
    /** The band above the recorder (`false` when the picker draws it in its own place). */
    showBand: boolean;
    children: React.ReactNode;
}

export const SpeakBandView: React.FC<{ band: SpeakBand }> = ({ band }) => (
    <div className="mb-3 flex items-start gap-3 rounded-3xl border-2 border-emerald-200 bg-emerald-50 p-3.5" data-testid="speak-band" style={{ fontFamily: SANS }}>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-700 text-white"><Mic size={22} aria-hidden="true" /></span>
        <span className="min-w-0">
            <span className="block text-[18px] font-extrabold leading-snug text-emerald-950" data-testid="speak-band-title">{band.title}</span>
            {band.hint && <span className="mt-0.5 block text-[15px] font-bold leading-snug text-stone-800" data-testid="speak-band-hint">{band.hint}</span>}
        </span>
    </div>
);

export const SpeakScreen: React.FC<SpeakScreenProps> = (p) => (
    <div className="fixed inset-0 z-[80] flex justify-center bg-stone-900/30">
        <div className={`flex h-full flex-col bg-stone-50 ${PHONE_COLUMN}`} role="dialog" aria-modal="true" aria-label={p.band.title}
            data-testid="speak-screen" data-purpose={p.purpose} data-processing={p.processing ? 'yes' : 'no'} style={{ fontFamily: SANS }}>
            {!p.processing && (p.showBack || p.placeLabel) && (
                <div className="flex shrink-0 items-center gap-2 border-b border-stone-200 bg-white px-3 py-2.5">
                    {p.showBack && (
                        <button type="button" onClick={p.onBack} data-testid="speak-back"
                            className="inline-flex min-h-[52px] shrink-0 items-center gap-2 rounded-full border border-stone-300 bg-white pl-2 pr-5 text-stone-800 shadow-sm active:scale-95">
                            <span className="grid h-9 w-9 place-items-center rounded-full bg-stone-100"><ArrowLeft size={22} strokeWidth={2.75} /></span>
                            <span className="text-[17px] font-extrabold">{p.backLabel}</span>
                        </button>
                    )}
                    {p.placeLabel && (
                        <span className="inline-flex min-w-0 items-center gap-1 text-[15px] font-extrabold text-stone-800" data-testid="speak-place">
                            <MapPin size={16} className="shrink-0 text-emerald-700" aria-hidden="true" />
                            <span className="truncate">{p.placeLabel}</span>
                        </span>
                    )}
                </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-24 pt-3">
                {p.processing ? p.processingNode : (
                    <>
                        {p.showBand && <SpeakBandView band={p.band} />}
                        {p.children}
                    </>
                )}
            </div>
        </div>
    </div>
);

export default SpeakScreen;
