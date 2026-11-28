/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (design-fidelity pass F3) — the small pieces the approved design repeats on the saved screen,
 * drawn with its own sizes and colours (sathi-ring.src.html): the white section card (`.rb-sec` with its `h4` and blue hint),
 * the square-cornered badge (`.bd` and its variants) and the white tick. Presentational only.
 */
import React from 'react';

export const SANS = "'Noto Sans Devanagari', sans-serif";

/** The design's `.rb-sec`: a white card, its small grey heading, and the blue hint on the right. */
export const RbSec: React.FC<{ title: React.ReactNode; hint?: React.ReactNode; hintTestId?: string; testId?: string; className?: string; children: React.ReactNode }> = ({
    title, hint, hintTestId, testId, className = '', children,
}) => (
    <section className={`rounded-[18px] border border-[#DDE3DA] bg-white p-3 ${className}`} data-testid={testId} style={{ fontFamily: SANS }}>
        <h4 className="m-0 mb-1.5 flex items-baseline justify-between gap-2 text-[13px] font-extrabold text-[#5F6B63]">
            <span>{title}</span>
            {hint && <span className="text-[12px] font-bold text-[#2D7FF9]" data-testid={hintTestId}>{hint}</span>}
        </h4>
        {children}
    </section>
);

export type BdTone = 'plain' | 'dark' | 'green' | 'blue' | 'amber' | 'who';

const BD_TONE: Record<BdTone, string> = {
    plain: 'border-[#DDE3DA] bg-[#FBFBF7] text-[#5F6B63]',
    who: 'border-[#DDE3DA] bg-[#FBFBF7] text-[#1C1917]',
    dark: 'border-[#065F46] bg-[#065F46] text-white',
    green: 'border-[#B7E4C7] bg-[#E9F8EE] text-[#0F6B3A]',
    blue: 'border-[#BFDBFE] bg-[#EFF6FF] text-[#1E40AF]',
    amber: 'border-[#F0DFA6] bg-[#FFF6D8] text-[#8A6400]',
};

/** The design's `.bd` badge: 8 px corners, 12 px heavy text. */
export const Bd: React.FC<{ tone?: BdTone; testId?: string; children: React.ReactNode; you?: boolean }> = ({ tone = 'plain', testId, children, you }) => (
    <span data-testid={testId} data-you={you === undefined ? undefined : you ? 'yes' : 'no'}
        className={`inline-flex items-center rounded-lg border px-2 py-0.5 text-[12px] font-extrabold leading-[1.5] ${BD_TONE[tone]}`}>
        {children}
    </span>
);

/** The design's white tick (`check`). */
export const Tick: React.FC<{ size: number }> = ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.5 8.4l3 3L12.5 5" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

/** The design's mic (`micSvg2`). */
export const MicGlyph: React.FC<{ size: number }> = ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
);

/** The final design's line glyphs (result-v12-final.html: `PEN`, `SAY`, `SPK`, `GO`, `TICK`, `RARR`). */
const LINE: Record<'pen' | 'say' | 'speaker' | 'go' | 'tick' | 'right', React.ReactNode> = {
    pen: <path d="M4 20h4L19 9l-4-4L4 16z" />,
    say: <path d="M4 5h16v10H10l-5 4v-4H4z" />,
    speaker: <><path d="M4 10v4h4l5 4V6L8 10z" /><path d="M16.5 9a4 4 0 0 1 0 6" /></>,
    go: <path d="M9 6l6 6-6 6" />,
    tick: <path d="M5 12.5l4.5 4.5L19 7.5" />,
    right: <path d="M5 12h14M13 6l6 6-6 6" />,
};
export const LineGlyph: React.FC<{ name: keyof typeof LINE; size: number; className?: string }> = ({ name, size, className }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === 'tick' ? 2.6 : 2.2}
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
        {LINE[name]}
    </svg>
);

/**
 * His own words under a value (the final design's `.said`): a small speech mark, then each phrase in the part's tint, exactly as he
 * said it. Nothing is drawn when there is no phrase (never an empty quote).
 */
export const SaidLine: React.FC<{ quotes: readonly string[]; tint: string; testId?: string; className?: string }> = ({ quotes, tint, testId, className = '' }) => {
    const shown = [...new Set(quotes.map(q => q.trim()).filter(Boolean))];
    if (shown.length === 0) return null;
    return (
        <span className={`flex items-start gap-1.5 ${className}`} data-testid={testId} style={{ fontFamily: SANS }}>
            <span className="mt-[3px] grid h-[18px] w-[18px] flex-none place-items-center text-[#78716C]"><LineGlyph name="say" size={16} /></span>
            <span className="flex min-w-0 flex-wrap gap-x-1.5 gap-y-1">
                {shown.map((q, i) => (
                    <span key={i} data-testid={testId ? `${testId}-q` : undefined}
                        className="rounded px-[5px] text-[14px] font-medium leading-[1.6] text-[#44403C]" style={{ background: tint }}>{q}</span>
                ))}
            </span>
        </span>
    );
};
