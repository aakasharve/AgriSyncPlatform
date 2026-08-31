/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared presentational primitives for the Labour feature, styled with the
 * app's real tokens (emerald/slate/amber, rounded cards, DM Sans font-black
 * numbers). Keeps each screen small and consistent. Bilingual Marathi · English
 * strings are inline per the app's farmer-facing convention.
 */
import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Wallet, ArrowLeft, Check, CloudOff, RefreshCw, Loader2 } from 'lucide-react';
import type { AvatarTone, LabourBalance, LabourPerson } from '../labourMock';
import { netBalance, inr } from '../labourMock';

const TONE: Record<AvatarTone, string> = {
    or: 'bg-orange-100 text-orange-600',
    em: 'bg-emerald-50 text-emerald-700',
    bl: 'bg-blue-100 text-blue-600',
    vi: 'bg-violet-100 text-violet-600',
    rs: 'bg-rose-100 text-rose-600',
    am: 'bg-amber-100 text-amber-700',
};

export const Avatar: React.FC<{ tone: AvatarTone; initial: string; size?: 'sm' | 'md' | 'lg' }> = ({ tone, initial, size = 'md' }) => {
    const dim = size === 'lg' ? 'h-14 w-14 text-xl' : size === 'sm' ? 'h-7 w-7 text-[12px] rounded-[9px]' : 'h-11 w-11 text-[17px]';
    return (
        <span className={`flex flex-shrink-0 items-center justify-center rounded-2xl font-black ${dim} ${TONE[tone]}`}>{initial}</span>
    );
};

/**
 * Honest load-failure banner for a REAL farm. Shown when `useLabourState`'s
 * fetch failed, so the farmer knows it's a LOAD FAILURE — not "you have no
 * workers / no money" (the data underneath is EMPTY_LABOUR_DATA, never
 * LABOUR_MOCK). Money-safety companion to the hook's `error` flag.
 */
export const LoadErrorBanner: React.FC<{ onRetry: () => void; compact?: boolean }> = ({ onRetry, compact }) => (
    // `compact` (Labour V1 Task 13) drops the SCREEN-level gutters so the same
    // banner can sit inside a card — FieldOperatorPicker's roster fetch — rather
    // than a second, parallel error banner being hand-rolled beside this one.
    // Nothing else changes, so every existing caller renders byte-identically.
    <div className={`${compact ? '' : 'mx-4 mt-2 '}flex items-center justify-between gap-3 rounded-[18px] border border-rose-100 bg-rose-50 px-3.5 py-3`}>
        <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white text-rose-500 ring-1 ring-rose-100">
                <CloudOff size={17} />
            </span>
            <span className="min-w-0 text-[12.5px] font-bold leading-snug text-rose-700">माहिती आणता आली नाही</span>
        </div>
        <button type="button" onClick={onRetry} className="flex flex-shrink-0 items-center gap-1.5 rounded-full bg-rose-600 px-3.5 py-2 text-[12px] font-extrabold text-white transition-transform active:scale-95">
            <RefreshCw size={13} /> पुन्हा प्रयत्न करा
        </button>
    </div>
);

export const GroupLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    // Was 11px + `uppercase tracking-[0.08em]`. Letter-spacing and uppercase are
    // Latin devices that do nothing for Devanagari except break up the word
    // shapes a slow reader relies on. Now 17px, normal spacing, darker.
    <div className="mb-1.5 mt-4 px-1 text-[17px] font-bold text-stone-500">{children}</div>
);

/**
 * Screen-honesty primitive (Decision 4b, 2026-07-19) — a full-screen "still
 * fetching" state for the Labour feature's FIRST load. Money screens must
 * never show a confident ₹0 they haven't verified against the server; this
 * is what stands in its place until the real numbers arrive.
 */
export const LoadingState: React.FC<{ label?: string; compact?: boolean }> = ({ label = 'माहिती आणत आहोत…', compact }) => (
    // `compact` (Labour V1 Task 13) trades the full-screen padding for card
    // padding so an in-card fetch (FieldOperatorPicker's roster) reuses THIS
    // primitive instead of growing a second spinner. Default unchanged.
    <div className={`flex flex-col items-center justify-center gap-3 text-center ${compact ? 'px-4 py-6' : 'px-6 py-24'}`}>
        <Loader2 size={28} className="animate-spin text-emerald-600" />
        <p className="text-[13px] font-bold text-slate-500">{label}</p>
    </div>
);

/**
 * Honest "nothing here yet" card — replaces a heading floating over an empty
 * list with a plain explanation (and an optional real action), per Decision
 * 4b: an honest empty screen is recoverable, a heading over nothing is not.
 */
export const EmptyState: React.FC<{ icon: React.ReactNode; title: string; subtitle: string; action?: React.ReactNode }> = ({ icon, title, subtitle, action }) => (
    <div className="flex flex-col items-center gap-2 rounded-[20px] border border-dashed border-slate-200 bg-white px-5 py-8 text-center">
        <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400">{icon}</span>
        <p className="text-[14px] font-bold text-slate-700">{title}</p>
        <p className="text-[12px] leading-relaxed text-slate-500">{subtitle}</p>
        {action}
    </div>
);

/**
 * One net-balance line: green "₹X द्यायचे" (to pay), amber "₹X उचल" (a real
 * advance outstanding), or — Decision 3a (2026-07-19) — a plain "₹X जास्त
 * दिलं" when Paid exceeds Recorded with NO advance given at all (never call
 * that an outstanding उचल — the worker was never advanced anything).
 *
 * Task 1 (P4) — renders NOTHING when `balance.recorded` is unknown
 * (`netBalance` returns `null`): with no job-card evidence, owe/overpaid/
 * advance are all equally unfounded claims. The honest render is the line's
 * absence, not a fabricated ₹0 or a fabricated "जास्त दिलं".
 */
export const MoneyLine: React.FC<{ balance: LabourBalance }> = ({ balance }) => {
    const net = netBalance(balance);
    if (!net) {
        return null;
    }
    const { owe, amount, isAdvance } = net;
    // The `IndianRupee` icon that used to lead these lines rendered a ₹ glyph
    // immediately before `inr()`'s own ₹, so every worker row literally read
    // "₹ ₹2,200 द्यायचे". Dropped — the figure carries its own symbol. `Wallet`
    // stays on the उचल line: it is a different idea (cash handed over early),
    // not a second rupee sign.
    if (owe) {
        return (
            <span className="mt-1 block text-[17px] font-extrabold text-emerald-700">
                {inr(amount)} द्यायचे
            </span>
        );
    }
    if (isAdvance) {
        return (
            <span className="mt-1 flex items-center gap-1.5 text-[17px] font-extrabold text-amber-700">
                <Wallet size={17} /> {inr(amount)} उचल
            </span>
        );
    }
    return (
        <span className="mt-1 block text-[17px] font-extrabold text-stone-600">
            {inr(amount)} जास्त दिलं
        </span>
    );
};

export const MukadamBadge: React.FC<{ sub?: boolean }> = ({ sub }) => (
    <span className={`rounded-lg border px-2.5 py-1 text-[15px] font-bold ${sub ? 'border-blue-100 bg-blue-50 text-blue-700' : 'border-violet-100 bg-violet-50 text-violet-700'}`}>
        {sub ? 'उप-मुकादम' : 'मुकादम'}
    </span>
);

export const TaskBadge: React.FC<{ task: string }> = ({ task }) => (
    <span className="rounded-lg border border-blue-100 bg-blue-50 px-2.5 py-1 text-[15px] font-bold text-blue-700">{task} टीम</span>
);

export const TempBadge: React.FC = () => (
    <span className="rounded-lg bg-orange-100 px-2.5 py-1 text-[15px] font-bold text-orange-700">तात्पुरता</span>
);

/**
 * Was the bare English string "name only" sitting beside a worker's name — two
 * English words in a Marathi wage book, meaningless to this farmer and, worse,
 * ambiguous: it reads like a comment about the person rather than about how
 * much the app knows. Now says the thing plainly in Marathi.
 */
export const NameOnlyBadge: React.FC = () => (
    <span className="rounded-lg bg-stone-100 px-2.5 py-1 text-[15px] font-bold text-stone-500">फक्त नाव</span>
);

/** A tappable person card (hub + team lists). */
export const PersonRow: React.FC<{ person: LabourPerson; teamCount?: number; onOpen: () => void }> = ({ person, teamCount, onOpen }) => {
    const isMukadam = person.role !== 'worker';
    return (
        <button
            type="button"
            onClick={onOpen}
            className={`group flex min-h-[84px] w-full items-center gap-3.5 rounded-[20px] border bg-white p-4 text-left shadow-[0_1px_3px_rgba(20,40,30,0.05)] transition-all active:scale-[0.98] ${isMukadam ? 'border-violet-100 hover:border-violet-200' : 'border-stone-100 hover:border-emerald-200/70'}`}
        >
            <Avatar tone={person.tone} initial={person.initial} />
            <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-[20px] font-bold text-stone-800">
                    {person.name}
                    {person.role === 'mukadam' && <MukadamBadge />}
                    {person.role === 'submukadam' && person.taskScope && <TaskBadge task={person.taskScope} />}
                </span>
                <MoneyLine balance={person.balance} />
            </span>
            {isMukadam && teamCount != null && (
                <span className="flex-shrink-0 rounded-lg bg-stone-100 px-2.5 py-1.5 text-[15px] font-extrabold text-stone-500">टीम {teamCount}</span>
            )}
            <ChevronRight size={26} className="flex-shrink-0 text-stone-400 transition-transform group-active:translate-x-0.5" />
        </button>
    );
};

/** Dashboard stat tile — big DM Sans font-black number + coloured icon chip. */
export const StatTile: React.FC<{ icon: React.ReactNode; tone: 'em' | 'am' | 'bl' | 'or' | 'vi'; value: string; label: string; trend?: number; onClick?: () => void }> = ({ icon, tone, value, label, trend, onClick }) => {
    const chip = tone === 'em' ? 'bg-emerald-50 text-emerald-700' : tone === 'am' ? 'bg-amber-100 text-amber-700' : tone === 'bl' ? 'bg-blue-50 text-blue-600' : tone === 'or' ? 'bg-orange-100 text-orange-600' : 'bg-violet-100 text-violet-600';
    return (
        <button type="button" onClick={onClick} disabled={!onClick} className={`relative rounded-[18px] border border-stone-100 bg-white p-4 text-left shadow-[0_1px_3px_rgba(20,40,30,0.05)] ${onClick ? 'active:scale-[0.98]' : ''}`}>
            <span className={`mb-2 flex h-10 w-10 items-center justify-center rounded-[12px] ${chip}`}>{icon}</span>
            {/*
              * TRUST BUG FIXED (2026-08-10). This badge hardcoded a green "↑"
              * whatever the number was, so a week where work FELL still showed
              * "↑ 4" in green — the app telling the farmer the opposite of the
              * truth about his own farm. Direction now follows the sign, and
              * the arrow is backed by a word, because an arrow glyph alone is
              * not something an illiterate user has been taught to read.
              */}
            {trend != null && trend !== 0 && (
                <span className={`absolute right-3 top-3 rounded-md px-2 py-0.5 text-[14px] font-extrabold ${trend > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-orange-700'}`}>
                    {trend > 0 ? '↑' : '↓'} {Math.abs(trend)} {trend > 0 ? 'जास्त' : 'कमी'}
                </span>
            )}
            <span className="block text-[30px] font-black leading-none tracking-tight text-stone-800 [font-variant-numeric:tabular-nums]">{value}</span>
            <span className="mt-1.5 block text-[16px] font-bold text-stone-500">{label}</span>
        </button>
    );
};

/** Back-header matching the SetupHub sub-screen pattern (bg #f6f7f5, back pill + centred title). */
export const BackHeader: React.FC<{ title: string; onBack: () => void }> = ({ title, onBack }) => (
    <div className="sticky top-0 z-20 flex items-center gap-3 bg-[#f6f7f5] px-4 pb-3 pt-2 shadow-[0_8px_14px_-12px_rgba(20,40,30,0.35)]">
        {/*
          * This is the ONLY way out of every sub-screen. It was 35px tall with
          * 13px text — under Android's 48px floor, on the one control a farmer
          * needs when he is lost. Now 56px.
          */}
        <button type="button" onClick={onBack} className="flex min-h-[56px] items-center gap-2 rounded-full bg-white py-3 pl-4 pr-5 text-[18px] font-bold text-stone-700 shadow-sm ring-1 ring-stone-100 transition-all active:scale-95">
            <ArrowLeft size={22} /> मागे
        </button>
        {/*
          * `uppercase tracking-wide` is a Latin typographic device — it does
          * nothing to Devanagari except loosen the letters and hurt legibility.
          * Dropped, and raised from 13px to 18px so the farmer can read where he is.
          */}
        <div className="flex-1 truncate pr-16 text-center text-[18px] font-bold text-stone-500">{title}</div>
    </div>
);

/**
 * The running-balance card used on person / mukadam detail — Option-3
 * wage-book: THREE distinct figures, never merged into one "earned":
 * काम झालं (recorded) · दिलं (paid) · बाकी (owed = recorded − paid − advance).
 * उचल (advance) is shown as a fourth tile only when it is > 0.
 *
 * `showActions` (Decision 4b, 2026-07-19) — defaults to `true` for API
 * stability, but BOTH real callers (`PersonDetail`, `MukadamDetail`) pass
 * `false`: neither "उचल द्या" nor "पैसे द्या/सेटल" is wired to anything real
 * yet (both fire a "— नमुना" placeholder toast, no server write at all), so
 * showing them would let a farmer believe cash was recorded when it wasn't.
 * Hidden, not deleted — flip back to `true` once these post to a real
 * endpoint.
 *
 * Task 1 (P4) — when `balance.recorded` is unknown (`netBalance` returns
 * `null`), the काम झालं tile reads `—` (the house pattern for an absent
 * fact) and the headline amount/label plus the बाकी/जास्त-दिलं tile are
 * omitted outright rather than showing a fabricated ₹0/owe/overpaid claim.
 * The card falls back to a neutral (non-owe, non-overpaid) style in that
 * case — no new copy is introduced anywhere in this fallback.
 */
export const BalanceCard: React.FC<{ balance: LabourBalance; why?: string; settleLabel: string; onAdvance: () => void; onSettle: () => void; showActions?: boolean }> = ({ balance, why, settleLabel, onAdvance, onSettle, showActions = true }) => {
    const net = netBalance(balance);
    const tiles: [string, string][] = [
        ['काम झालं', balance.recorded === null ? '—' : inr(balance.recorded)],
        ['दिलं', inr(balance.paid)],
    ];
    if (balance.advance > 0) tiles.push(['उचल', inr(balance.advance)]);
    if (net) {
        tiles.push([net.owe ? 'बाकी' : (net.isAdvance ? 'उचल बाकी' : 'जास्त दिलं'), inr(net.amount)]);
    }

    return (
        <div className={`rounded-[24px] border p-4 shadow-[0_1px_3px_rgba(20,40,30,0.05)] ${net === null ? 'border-stone-100 bg-white' : net.owe ? 'border-emerald-100 bg-gradient-to-br from-emerald-50 to-white' : 'border-amber-200 bg-gradient-to-br from-amber-50 to-white'}`}>
            {net && (
                <div className="flex items-baseline justify-between gap-2">
                    <span className={`font-black leading-none tracking-tight [font-variant-numeric:tabular-nums] text-[40px] ${net.owe ? 'text-emerald-700' : 'text-amber-700'}`}>{inr(net.amount)}</span>
                    <span className="text-right text-[18px] font-bold text-stone-600">{net.owe ? 'द्यायचे' : (net.isAdvance ? 'उचल बाकी' : 'जास्त दिलं')}</span>
                </div>
            )}
            {/*
              * These four labels (काम झालं / दिलं / उचल / बाकी) were 9px — the
              * smallest text on the screen was the text telling the farmer WHICH
              * money each number is. At 9px he sees four rupee figures and no
              * way to tell them apart, which is precisely how trust in a wage
              * book dies. Labels are now 15px and darker than the figure's
              * container, and the tiles stack 2-up so nothing is squeezed.
              */}
            <div className="mt-3.5 grid grid-cols-2 gap-2.5">
                {tiles.map(([l, v]) => (
                    <div key={l} className="rounded-xl border border-stone-100 bg-stone-50 p-3 text-center">
                        <div className="text-[15px] font-bold text-stone-500">{l}</div>
                        <div className="mt-1 text-[22px] font-black text-stone-800 [font-variant-numeric:tabular-nums]">{v}</div>
                    </div>
                ))}
            </div>
            {why && <div className="mt-3 rounded-xl bg-white/70 px-3 py-2.5 text-center text-[16px] leading-snug text-stone-600">{why}</div>}
            {showActions && (
                <div className="mt-3 grid grid-cols-2 gap-2.5">
                    <button type="button" onClick={onAdvance} className="flex min-h-[60px] items-center justify-center gap-2 rounded-[14px] bg-amber-600 py-4 text-[18px] font-extrabold text-white transition-transform active:scale-[0.97]">
                        <Wallet size={20} /> उचल द्या
                    </button>
                    <button type="button" onClick={onSettle} className="flex min-h-[60px] items-center justify-center gap-2 rounded-[14px] bg-emerald-600 py-4 text-[18px] font-extrabold text-white transition-transform active:scale-[0.97]">
                        <Check size={20} /> {settleLabel}
                    </button>
                </div>
            )}
        </div>
    );
};

/**
 * "हे कसं चालतं?" — an expandable helper (काय आहे / काय करायचं / का), matching the
 * app's SetupHub "?" help pattern. Plain Marathi so a semi-literate owner never
 * has to guess what a screen does.
 */
export const HelpNote: React.FC<{ what: string; act: string; why: string; label?: string }> = ({ what, act, why, label = 'हे कसं चालतं?' }) => {
    const [open, setOpen] = useState(false);
    return (
        <div>
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-[56px] w-full items-center gap-3 rounded-[14px] border border-stone-100 bg-white px-3.5 py-3 text-left shadow-[0_1px_3px_rgba(20,40,30,0.05)] active:scale-[0.99]">
                <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border text-[19px] font-bold ${open ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-stone-200 bg-white text-stone-500'}`}>?</span>
                <span className="flex-1 text-[17px] font-bold text-stone-600">{label}</span>
                <ChevronDown size={24} className={`flex-shrink-0 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div data-testid="help-note-body" className="mt-1.5 rounded-[13px] border border-emerald-100 bg-emerald-50 p-4">
                    {([['काय आहे', what], ['काय करायचं', act], ['का?', why]] as [string, string][]).map(([k, v], i) => (
                        // Stacked, not a 76px side column: at 17px the Marathi
                        // heading no longer fits a narrow gutter, and stacking
                        // gives the answer the full screen width to breathe.
                        <div key={k} className={`${i > 0 ? 'mt-3 border-t border-emerald-100 pt-3' : ''}`}>
                            <span className="block text-[16px] font-extrabold text-emerald-700">{k}</span>
                            <span className="mt-0.5 block text-[17px] font-semibold leading-snug text-stone-700">{v}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
