/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 — founder 2026-11-26: "exact replication" of the approved design. The design shows the voice flow
 * full screen with ONE slim bar (the place chip on the left, "या महिन्यात N दिवस" on the right), not the app's big header, tabs
 * and bottom bar. V2Shell is that frame: a fixed full-screen layer, the design's background (#FBFBF7), the slim bar, a scrolling
 * body and an optional footer. Rendered through a portal so no transformed ancestor can trap it: into the app's root frame
 * (`AppShell`, marked `data-app-shell`) when there is one, so it takes its place in the app's OWN layer order — above the app's
 * header (z-50) and bottom bar (z-40), below the one approval sheet (z-60) and the app's toast (lifted by `AboveV2Shell`). Seen on
 * localhost 2026-11-26: portalled into `document.body` the frame covered the toast and the approval sheet, because `AppShell` is
 * `position: fixed` and so is a layer of its own. Anything portalled into `document.body` (the record-audience sheet) is above it.
 * No app frame (a test, a lone preview) = `document.body`.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { FEATURE_FLAGS } from '../../../../app/featureFlags';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { digitsFor } from '../../../../shared/utils/marathiDigits';
import type { DailyLog } from '../../../../types';

const SANS = "'Noto Sans Devanagari', sans-serif";

/** Days of THIS month with at least one record — a count, never a streak (Silverman & Barasch; the design's "या महिन्यात १८ दिवस"). */
export function daysRecordedThisMonth(logs: readonly Pick<DailyLog, 'date'>[], today: Date = new Date()): number {
    const prefix = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-`;
    return new Set(logs.map(l => l.date).filter((d): d is string => typeof d === 'string' && d.startsWith(prefix))).size;
}

export const daysLabel = (n: number, language: string | null | undefined): string =>
    language === 'en' ? `${n} days this month` : `या महिन्यात ${digitsFor(n, 'mr')} दिवस`; // PROPOSED (Marathi) — the approved design's words

/**
 * The app's toast sits at the header's own layer (z-50) in the app frame; with the flag on it is lifted one step above the v2 frame
 * (a stacking layer of its own; a `fixed` toast inside still places itself on the screen). Flag off: the child alone, as before.
 */
export const AboveV2Shell: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    (FEATURE_FLAGS.voiceFlowV2 ? <div className="relative z-[52]" data-testid="above-v2-shell">{children}</div> : <>{children}</>);

export interface V2ShellProps {
    /** "द्राक्ष · Grapes A" — the place chip. */
    place: string;
    /** Days recorded this month (a count); null = not shown. */
    days: number | null;
    /** A back arrow on the left of the bar; absent = none. */
    onBack?: () => void;
    backLabel?: string;
    /** Sticky footer (e.g. the saved screen's mic + 30 s bar, or the red stop). */
    footer?: React.ReactNode;
    /** The footer on the screen's own background with no line above it (the design's recording `.micbar`). */
    plainFooter?: boolean;
    testId?: string;
    children: React.ReactNode;
}

export const V2Shell: React.FC<V2ShellProps> = ({ place, days, onBack, backLabel, footer, plainFooter = false, testId = 'v2-shell', children }) => {
    const language = useOptionalLanguage()?.language;
    const frame = (
        <div className="fixed inset-0 z-[51] flex flex-col bg-[#FBFBF7] text-[#1C1917]" data-testid={testId} style={{ fontFamily: SANS }}>
            <div className="flex items-center gap-2 px-4 pb-2 pt-[max(8px,var(--safe-area-inset-top,env(safe-area-inset-top)))]" data-testid="v2-appbar">
                {onBack && (
                    <button type="button" onClick={onBack} aria-label={backLabel ?? 'मागे'} data-testid="v2-back"
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#DDE3DA] bg-white text-[18px] font-bold">←</button>
                )}
                <span className="min-w-0 truncate rounded-full border border-[#DDE3DA] bg-white px-2.5 py-1 text-[13.5px] font-bold" data-testid="v2-place">{place}</span>
                {days != null && days > 0 && (
                    <span className="ml-auto shrink-0 rounded-full px-[9px] py-1 text-[12px] font-bold text-[#0F6B3A]" style={{ background: '#E4F3EA' }} data-testid="v2-days">
                        {daysLabel(days, language)}
                    </span>
                )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3" data-testid="v2-body">{children}</div>
            {footer && (
                <div className={`shrink-0 pb-[var(--safe-area-inset-bottom,env(safe-area-inset-bottom))] ${plainFooter ? 'bg-[#FBFBF7]' : 'border-t border-[#DDE3DA] bg-white'}`} data-testid="v2-footer">{footer}</div>
            )}
        </div>
    );
    if (typeof document === 'undefined') return frame;
    return createPortal(frame, document.querySelector<HTMLElement>('[data-app-shell]') ?? document.body);
};

export default V2Shell;
