/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I7 / WP-5, I8) — the few building blocks every
 * redesigned page uses (सेट-अप केंद्र, and the bottom-bar places: खरेदी, उत्पन्न, पैसे व हिशोब), taken
 * from the founder-approved preview (PLR-D9 `app/ui.tsx`) so every page looks and behaves the same: one
 * title bar with ONE big "मागे", the app's light glass card, one way a row looks, big buttons and
 * switches, and a plain "लवकरच" for a part that is not built (never a dead button). Presentational only
 * — no data, no sample values. Moved here from `features/profile/components/hubUi.tsx` when the money
 * pages started using it too.
 */
import React, { useState } from 'react';
import { ArrowLeft, ChevronRight, Clock3, Smartphone } from 'lucide-react';

/** Marathi body text (CHARTER font rule). */
export const SANS = "'Noto Sans Devanagari', sans-serif";

interface RippleState { x: number; y: number; size: number; id: number }

/** A button that presses in and ripples from the finger (the page switcher's tap feel). */
export const Tap: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { rippleColor?: string }> = ({
    className = '', rippleColor = 'rgba(16,185,129,0.22)', children, onPointerDown, ...rest
}) => {
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

/** The one title bar: big "मागे" + the page title. Sticks to the top; bleeds to the page edges. */
export const PageBar: React.FC<{ title: string; onBack?: () => void }> = ({ title, onBack }) => (
    <div className="sticky top-0 z-20 -mx-4 mb-3 flex items-center gap-2 border-b border-stone-200/70 bg-white/90 px-3 py-2 backdrop-blur-md sm:-mx-6"
        data-testid="page-bar" style={{ fontFamily: SANS }}>
        {onBack && (
            <Tap onClick={onBack} data-testid="page-back" aria-label="मागे"
                className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3.5 text-[15px] font-extrabold text-stone-800 shadow-sm">
                <ArrowLeft size={20} strokeWidth={2.4} aria-hidden="true" />मागे
            </Tap>
        )}
        <h1 className="m-0 min-w-0 flex-1 truncate text-[19px] font-extrabold text-stone-900" data-testid="page-title">{title}</h1>
    </div>
);

export const GlassCard: React.FC<{ className?: string; children: React.ReactNode; testId?: string }> = ({ className = '', children, testId }) => (
    <section data-testid={testId} className={`rounded-3xl border border-white/60 bg-white/80 p-3.5 shadow-[0_4px_18px_-8px_rgba(28,25,23,0.18)] backdrop-blur-md ${className}`}>{children}</section>
);

export const SectionHead: React.FC<{ title: string; hint?: string }> = ({ title, hint }) => (
    <div className="px-1 pt-2">
        <h2 className="m-0 text-[17px] font-extrabold text-stone-900">{title}</h2>
        {hint && <p className="m-0 text-[13.5px] font-semibold leading-snug text-stone-600">{hint}</p>}
    </div>
);

export type Tone = 'green' | 'blue' | 'amber' | 'rose' | 'violet' | 'stone';
const TONE: Record<Tone, string> = {
    green: 'bg-emerald-100 text-emerald-800',
    blue: 'bg-blue-100 text-blue-800',
    amber: 'bg-amber-100 text-amber-800',
    rose: 'bg-rose-100 text-rose-800',
    violet: 'bg-violet-100 text-violet-800',
    stone: 'bg-stone-100 text-stone-700',
};

export const IconDot: React.FC<{ tone: Tone; children: React.ReactNode; size?: number }> = ({ tone, children, size = 44 }) => (
    <span className={`grid shrink-0 place-items-center rounded-2xl ${TONE[tone]}`} style={{ width: size, height: size }}>{children}</span>
);

export const Chip: React.FC<{ tone: Tone; children: React.ReactNode }> = ({ tone, children }) => (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12.5px] font-extrabold ${TONE[tone]}`}>{children}</span>
);

/** Icon in a tinted square · title · one short line · chevron — the one way a list row looks. */
export const RowLink: React.FC<{ icon: React.ReactNode; tone: Tone; title: string; line?: string; badge?: React.ReactNode; onClick: () => void; testId?: string; danger?: boolean }> = ({
    icon, tone, title, line, badge, onClick, testId, danger,
}) => (
    <Tap onClick={onClick} data-testid={testId}
        className={`flex min-h-[64px] w-full items-center gap-3 rounded-2xl border bg-white px-3 py-2.5 text-left shadow-[0_1px_2px_rgba(28,25,23,0.05)] ${danger ? 'border-rose-200' : 'border-stone-200/80'}`}>
        <IconDot tone={tone}>{icon}</IconDot>
        <span className="min-w-0 flex-1">
            <span className={`block text-[16px] font-extrabold leading-tight ${danger ? 'text-rose-700' : 'text-stone-900'}`}>{title}</span>
            {line && <span className="mt-0.5 block text-[13px] font-semibold leading-snug text-stone-600">{line}</span>}
        </span>
        {badge}
        {!danger && <ChevronRight size={22} className="shrink-0 text-stone-400" aria-hidden="true" />}
    </Tap>
);

export const BigButton: React.FC<{ onClick: () => void; children: React.ReactNode; tone?: 'green' | 'blue' | 'white'; testId?: string; disabled?: boolean }> = ({
    onClick, children, tone = 'green', testId, disabled,
}) => (
    <Tap onClick={onClick} data-testid={testId} disabled={disabled} rippleColor={tone === 'white' ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.35)'}
        className={`flex min-h-[56px] w-full items-center justify-center gap-2 rounded-full px-5 text-[17px] font-extrabold disabled:opacity-50 ${
            tone === 'green' ? 'bg-gradient-to-r from-emerald-700 via-emerald-600 to-emerald-500 text-white shadow-[0_12px_28px_-10px_rgba(4,120,87,0.6)]'
                : tone === 'blue' ? 'bg-blue-700 text-white shadow-[0_12px_28px_-10px_rgba(20,72,230,0.6)]'
                    : 'border-2 border-emerald-600 bg-white text-emerald-800'}`}>
        {children}
    </Tap>
);

/** A labelled on/off switch row (big target). */
export const SwitchRow: React.FC<{ on: boolean; onChange: (v: boolean) => void; label: string; testId?: string }> = ({ on, onChange, label, testId }) => (
    <Tap onClick={() => onChange(!on)} role="switch" aria-checked={on} data-testid={testId}
        className="flex min-h-[52px] w-full items-center gap-3 rounded-2xl bg-white px-3 text-left ring-1 ring-stone-200">
        <span className="min-w-0 flex-1 text-[15px] font-extrabold text-stone-800">{label}</span>
        <span className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${on ? 'bg-emerald-600' : 'bg-stone-300'}`}>
            <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? 'left-7' : 'left-1'}`} />
        </span>
    </Tap>
);

/** One choice out of a few, as big chips. */
export function ChoiceChips<K extends string>({ items, value, onPick, testId }: { items: readonly (readonly [K, string])[]; value: K; onPick: (k: K) => void; testId: string }) {
    return (
        <div className="flex flex-wrap gap-1.5">
            {items.map(([k, l]) => (
                <Tap key={k} onClick={() => onPick(k)} aria-pressed={value === k} data-testid={`${testId}-${k}`}
                    className={`min-h-[44px] rounded-full px-3.5 text-[14.5px] font-extrabold ${value === k ? 'bg-blue-700 text-white' : 'bg-white text-stone-700 ring-1 ring-stone-300'}`}>{l}</Tap>
            ))}
        </div>
    );
}

/** A part that is not built yet: said plainly, never a dead button (doctrine P5). */
export const Soon: React.FC<{ what: string }> = ({ what }) => (
    <p className="m-0 flex items-start gap-2 rounded-2xl border border-dashed border-stone-300 bg-stone-50 p-3 text-[13.5px] font-bold leading-snug text-stone-600" data-testid="soon">
        <Clock3 size={17} className="mt-0.5 shrink-0" aria-hidden="true" />{what} — लवकरच.
    </p>
);

/** Setup that lives only on this phone says so (PENDING D-9: not shared with the farm's other phones). */
export const ThisPhoneOnly: React.FC = () => (
    <p data-testid="setup-this-phone-only" className="m-0 flex items-start gap-2 rounded-2xl bg-amber-50 px-3 py-2 text-[13.5px] font-bold leading-snug text-amber-800 ring-1 ring-amber-200">
        <Smartphone size={17} className="mt-0.5 shrink-0" aria-hidden="true" />फक्त या फोनवर साठवलं जातं — शेतातल्या इतर फोनवर दिसत नाही.
    </p>
);

/** Big text input with a label and an optional error line. */
export const TextField: React.FC<{ label: string; value: string; onChange: (v: string) => void; placeholder?: string; error?: string; testId?: string; type?: 'text' | 'number'; autoFocus?: boolean }> = ({
    label, value, onChange, placeholder, error, testId, type = 'text', autoFocus,
}) => (
    <label className="block">
        <span className="text-[13.5px] font-extrabold text-stone-700">{label}</span>
        <input type={type} inputMode={type === 'number' ? 'decimal' : undefined} value={value} autoFocus={autoFocus}
            onChange={e => onChange(e.target.value)} placeholder={placeholder} data-testid={testId}
            className={`mt-1 min-h-[52px] w-full rounded-xl bg-white px-3 text-[17px] font-bold text-stone-900 outline-none ring-1 focus:ring-2 focus:ring-emerald-500 ${error ? 'ring-rose-400' : 'ring-stone-300'}`} />
        {error && <span className="mt-1 block text-[13px] font-extrabold text-rose-700" data-testid={testId ? `${testId}-error` : undefined}>{error}</span>}
    </label>
);
