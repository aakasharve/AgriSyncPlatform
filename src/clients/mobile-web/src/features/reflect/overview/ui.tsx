/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6, WP-3)
 *
 * The few pieces every section of "पूर्ण शेतीचा आढावा" shares, copied from the approved preview:
 *   - SectionBlock: a section that folds shut and opens again. Big Marathi title, one icon, a count when there
 *     is one. spec: plr-d10 (I22, founder D-4, 26 Oct — later than the 25 Oct "make them fixed"): "Treat
 *     remembered folds and section order as existing functionality." So the page may CONTROL it — `open` +
 *     `onToggle` (the fold it remembers, `useSectionLayout.ts`) and `onMoveUp` / `onMoveDown` (only while the
 *     page's "क्रम बदला" is on). Without them it behaves as before: open, folded only for this visit.
 *   - Tap: anything tappable presses in and ripples from the finger.
 *   - CropPhoto: the crop's real photo (`cropImageUrl`), or a plain leaf when there is none.
 *   - Num: a figure in DM Sans (font rule: numbers in DM Sans, Marathi in Noto Sans Devanagari).
 */
import React, { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Sprout } from 'lucide-react';
import { useCropPicture } from '../../context/components/cropImage';

export const SANS = "'Noto Sans Devanagari', sans-serif";
export const NUM = "'DM Sans', sans-serif";

export type Tone = 'green' | 'blue' | 'amber' | 'rose' | 'violet' | 'stone';
const TONE: Record<Tone, string> = {
    green: 'bg-emerald-100 text-emerald-800',
    blue: 'bg-blue-100 text-blue-800',
    amber: 'bg-amber-100 text-amber-800',
    rose: 'bg-rose-100 text-rose-800',
    violet: 'bg-violet-100 text-violet-800',
    stone: 'bg-stone-100 text-stone-700',
};

interface RippleState { x: number; y: number; size: number; id: number }

/** A button that presses in and ripples from the finger. */
export const Tap: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { rippleColor?: string }> = ({ className = '', rippleColor = 'rgba(16,185,129,0.22)', children, onPointerDown, ...rest }) => {
    const [r, setR] = useState<RippleState | null>(null);
    return (
        <button type="button" {...rest}
            onPointerDown={e => {
                const b = e.currentTarget.getBoundingClientRect();
                setR({ x: e.clientX - b.left, y: e.clientY - b.top, size: Math.max(b.width, b.height) * 2.2, id: Date.now() });
                onPointerDown?.(e);
            }}
            className={`relative overflow-hidden transition-transform duration-150 active:scale-[0.97] ${className}`}>
            {r && <span key={r.id} aria-hidden="true" className="pointer-events-none absolute animate-nav-ripple rounded-full"
                style={{ left: r.x - r.size / 2, top: r.y - r.size / 2, width: r.size, height: r.size, background: rippleColor }} />}
            {children}
        </button>
    );
};

export const Num: React.FC<{ children: React.ReactNode; className?: string; testId?: string }> = ({ children, className, testId }) => (
    <span className={className} style={{ fontFamily: NUM }} data-testid={testId}>{children}</span>
);

export const IconDot: React.FC<{ tone: Tone; children: React.ReactNode; size?: number }> = ({ tone, children, size = 42 }) => (
    <span className={`grid shrink-0 place-items-center rounded-2xl ${TONE[tone]}`} style={{ width: size, height: size }}>{children}</span>
);

const MoveButton: React.FC<{ onClick?: () => void; label: string; testId: string; children: React.ReactNode }> = ({ onClick, label, testId, children }) => (
    <Tap onClick={onClick} disabled={!onClick} aria-label={label} data-testid={testId}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-stone-100 text-stone-700 ring-1 ring-stone-300 disabled:opacity-30">
        {children}
    </Tap>
);

export const SectionBlock: React.FC<{
    id: string; title: string; icon: React.ReactNode; tone: Tone; hint?: string; count?: React.ReactNode; children: React.ReactNode;
    /** Controlled fold (remembered by the page). Omit → open, folded only for this visit. */
    open?: boolean;
    onToggle?: () => void;
    /** Order controls, drawn only while the page's "क्रम बदला" is on; an edge passes `undefined` (drawn disabled). */
    reorder?: { onMoveUp?: () => void; onMoveDown?: () => void };
}> = ({ id, title, icon, tone, hint, count, children, open: openProp, onToggle, reorder }) => {
    const [ownOpen, setOwnOpen] = useState(true);
    const open = openProp ?? ownOpen;
    const toggle = onToggle ?? (() => setOwnOpen(o => !o));
    return (
        <section data-testid={`reflect-section-${id}`}
            className="overflow-hidden rounded-[26px] border border-white/60 bg-white/80 shadow-[0_4px_18px_-8px_rgba(28,25,23,0.18)] backdrop-blur-md">
            <div className="flex items-center">
                <Tap onClick={toggle} aria-expanded={open} data-testid={`reflect-section-${id}-toggle`}
                    className="flex min-h-[64px] min-w-0 flex-1 items-center gap-3 px-3.5 py-2.5 text-left">
                    <IconDot tone={tone}>{icon}</IconDot>
                    <span className="min-w-0 flex-1">
                        <span className="block text-[17.5px] font-extrabold leading-tight text-stone-900">{title}</span>
                        {hint && <span className="block text-[12.5px] font-semibold leading-snug text-stone-500">{hint}</span>}
                    </span>
                    {count}
                    <ChevronDown size={22} className={`shrink-0 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                </Tap>
                {reorder && (
                    <span className="flex shrink-0 gap-1.5 pr-3" data-testid={`reflect-section-${id}-reorder`}>
                        {/* PROPOSED (Marathi) */}
                        <MoveButton onClick={reorder.onMoveUp} label={`${title} वर हलवा`} testId={`reflect-section-${id}-up`}><ArrowUp size={20} aria-hidden="true" /></MoveButton>
                        <MoveButton onClick={reorder.onMoveDown} label={`${title} खाली हलवा`} testId={`reflect-section-${id}-down`}><ArrowDown size={20} aria-hidden="true" /></MoveButton>
                    </span>
                )}
            </div>
            {open && <div className="border-t border-stone-100 px-3 pb-3.5 pt-3">{children}</div>}
        </section>
    );
};

/** The crop's real photo, round; a plain leaf when the crop has none. */
export const CropPhoto: React.FC<{ iconName: string; name: string; px: number; className?: string }> = ({ iconName, name, px, className = '' }) => {
    // spec I18 — the crop master's picture by MHCR id, then the app's photo of the same crop, then a leaf.
    const { src, onError } = useCropPicture({ name, iconName }, 480);
    return src
        ? <img src={src} alt="" width={px} height={px} style={{ width: px, height: px }} className={`shrink-0 rounded-full object-cover shadow-sm ${className}`} draggable={false} loading="lazy" onError={onError} />
        : <span style={{ width: px, height: px }} className={`grid shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700 ${className}`} aria-hidden="true"><Sprout size={Math.round(px * 0.5)} /></span>;
};
