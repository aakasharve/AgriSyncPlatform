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
import { ChevronRight, ChevronDown, Wallet, IndianRupee, ArrowLeft, Check, CloudOff, RefreshCw } from 'lucide-react';
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
export const LoadErrorBanner: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
    <div className="mx-4 mt-2 flex items-center justify-between gap-3 rounded-[18px] border border-rose-100 bg-rose-50 px-3.5 py-3">
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
    <div className="mb-1 mt-3 px-1 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">{children}</div>
);

/** One net-balance line: green "₹X द्यायचे" (to pay) or amber "₹X उचल" (advance out). */
export const MoneyLine: React.FC<{ balance: LabourBalance }> = ({ balance }) => {
    const { owe, amount } = netBalance(balance);
    return owe ? (
        <span className="mt-1 flex items-center gap-1.5 text-[12.5px] font-extrabold text-emerald-700">
            <IndianRupee size={13} /> {inr(amount)} द्यायचे
        </span>
    ) : (
        <span className="mt-1 flex items-center gap-1.5 text-[12.5px] font-extrabold text-amber-700">
            <Wallet size={13} /> {inr(amount)} उचल
        </span>
    );
};

export const MukadamBadge: React.FC<{ sub?: boolean }> = ({ sub }) => (
    <span className={`rounded-lg border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${sub ? 'border-blue-100 bg-blue-50 text-blue-700' : 'border-violet-100 bg-violet-50 text-violet-700'}`}>
        {sub ? 'उप-मुकादम' : 'मुकादम'}
    </span>
);

export const TaskBadge: React.FC<{ task: string }> = ({ task }) => (
    <span className="rounded-lg border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">{task} टीम</span>
);

export const TempBadge: React.FC = () => (
    <span className="rounded-lg bg-orange-100 px-2 py-0.5 text-[9px] font-bold uppercase text-orange-700">तात्पुरता</span>
);

export const NameOnlyBadge: React.FC = () => (
    <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">name only</span>
);

/** A tappable person card (hub + team lists). */
export const PersonRow: React.FC<{ person: LabourPerson; teamCount?: number; onOpen: () => void }> = ({ person, teamCount, onOpen }) => {
    const isMukadam = person.role !== 'worker';
    return (
        <button
            type="button"
            onClick={onOpen}
            className={`group flex w-full items-center gap-3.5 rounded-[20px] border bg-white p-3.5 text-left shadow-[0_1px_3px_rgba(20,40,30,0.05)] transition-all active:scale-[0.98] ${isMukadam ? 'border-violet-100 hover:border-violet-200' : 'border-slate-100 hover:border-emerald-200/70'}`}
        >
            <Avatar tone={person.tone} initial={person.initial} />
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 truncate text-[15px] font-bold text-slate-800">
                    {person.name}
                    {person.role === 'mukadam' && <MukadamBadge />}
                    {person.role === 'submukadam' && person.taskScope && <TaskBadge task={person.taskScope} />}
                </span>
                <MoneyLine balance={person.balance} />
            </span>
            {isMukadam && teamCount != null && (
                <span className="flex-shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-extrabold text-slate-500">टीम {teamCount}</span>
            )}
            <ChevronRight size={18} className="flex-shrink-0 text-slate-300 transition-transform group-active:translate-x-0.5" />
        </button>
    );
};

/** Dashboard stat tile — big DM Sans font-black number + coloured icon chip. */
export const StatTile: React.FC<{ icon: React.ReactNode; tone: 'em' | 'am' | 'bl' | 'or' | 'vi'; value: string; label: string; trend?: number; onClick?: () => void }> = ({ icon, tone, value, label, trend, onClick }) => {
    const chip = tone === 'em' ? 'bg-emerald-50 text-emerald-700' : tone === 'am' ? 'bg-amber-100 text-amber-700' : tone === 'bl' ? 'bg-blue-50 text-blue-600' : tone === 'or' ? 'bg-orange-100 text-orange-600' : 'bg-violet-100 text-violet-600';
    return (
        <button type="button" onClick={onClick} disabled={!onClick} className={`relative rounded-[18px] border border-slate-100 bg-white p-3.5 text-left shadow-[0_1px_3px_rgba(20,40,30,0.05)] ${onClick ? 'active:scale-[0.98]' : ''}`}>
            <span className={`mb-2 flex h-8 w-8 items-center justify-center rounded-[10px] ${chip}`}>{icon}</span>
            {trend != null && <span className="absolute right-3 top-3 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-extrabold text-emerald-700">↑ {trend}</span>}
            <span className="block text-[26px] font-black leading-none tracking-tight text-slate-800 [font-variant-numeric:tabular-nums]">{value}</span>
            <span className="mt-1 block text-[11px] font-bold text-slate-500">{label}</span>
        </button>
    );
};

/** Back-header matching the SetupHub sub-screen pattern (bg #f6f7f5, back pill + centred title). */
export const BackHeader: React.FC<{ title: string; onBack: () => void }> = ({ title, onBack }) => (
    <div className="sticky top-0 z-20 flex items-center gap-3 bg-[#f6f7f5] px-4 pb-3 pt-2 shadow-[0_8px_14px_-12px_rgba(20,40,30,0.35)]">
        <button type="button" onClick={onBack} className="flex items-center gap-1.5 rounded-full bg-white py-2 pl-2.5 pr-3.5 text-[13px] font-bold text-slate-700 shadow-sm ring-1 ring-slate-100 transition-all active:scale-95">
            <ArrowLeft size={16} /> मागे
        </button>
        <div className="flex-1 truncate pr-16 text-center text-[13px] font-bold uppercase tracking-wide text-slate-400">{title}</div>
    </div>
);

/**
 * The running-balance card used on person / mukadam detail — Option-3
 * wage-book: THREE distinct figures, never merged into one "earned":
 * काम झालं (recorded) · दिलं (paid) · बाकी (owed = recorded − paid − advance).
 * उचल (advance) is shown as a fourth tile only when it is > 0.
 */
export const BalanceCard: React.FC<{ balance: LabourBalance; why?: string; settleLabel: string; onAdvance: () => void; onSettle: () => void }> = ({ balance, why, settleLabel, onAdvance, onSettle }) => {
    const { owe, amount } = netBalance(balance);
    const tiles: [string, string][] = [
        ['काम झालं', inr(balance.recorded)],
        ['दिलं', inr(balance.paid)],
    ];
    if (balance.advance > 0) tiles.push(['उचल', inr(balance.advance)]);
    tiles.push([owe ? 'बाकी' : 'उचल बाकी', inr(amount)]);

    return (
        <div className={`rounded-[24px] border p-4 shadow-[0_1px_3px_rgba(20,40,30,0.05)] ${owe ? 'border-emerald-100 bg-gradient-to-br from-emerald-50 to-white' : 'border-amber-200 bg-gradient-to-br from-amber-50 to-white'}`}>
            <div className="flex items-baseline justify-between gap-2">
                <span className={`font-black leading-none tracking-tight [font-variant-numeric:tabular-nums] text-[36px] ${owe ? 'text-emerald-700' : 'text-amber-700'}`}>{inr(amount)}</span>
                <span className="text-right text-[13px] font-bold text-slate-600">{owe ? 'द्यायचे' : 'उचल बाकी'}</span>
            </div>
            <div className={`mt-3 grid gap-2 ${tiles.length === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
                {tiles.map(([l, v]) => (
                    <div key={l} className="rounded-xl border border-slate-100 bg-slate-50 p-2 text-center">
                        <div className="text-[12px] font-black text-slate-700 [font-variant-numeric:tabular-nums]">{v}</div>
                        <div className="mt-0.5 text-[9px] font-semibold text-slate-400">{l}</div>
                    </div>
                ))}
            </div>
            {why && <div className="mt-2.5 text-center text-[11px] text-slate-400">{why}</div>}
            <div className="mt-3 grid grid-cols-2 gap-2.5">
                <button type="button" onClick={onAdvance} className="flex items-center justify-center gap-2 rounded-[14px] bg-amber-600 py-3 text-[13px] font-extrabold text-white transition-transform active:scale-[0.97]">
                    <Wallet size={16} /> उचल द्या
                </button>
                <button type="button" onClick={onSettle} className="flex items-center justify-center gap-2 rounded-[14px] bg-emerald-600 py-3 text-[13px] font-extrabold text-white transition-transform active:scale-[0.97]">
                    <Check size={16} /> {settleLabel}
                </button>
            </div>
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
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2.5 rounded-[14px] border border-slate-100 bg-white px-3 py-2.5 text-left shadow-[0_1px_3px_rgba(20,40,30,0.05)] active:scale-[0.99]">
                <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border font-serif text-[13px] font-bold ${open ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 bg-white text-slate-500'}`}>?</span>
                <span className="flex-1 text-[12.5px] font-bold text-slate-600">{label}</span>
                <ChevronDown size={16} className={`flex-shrink-0 text-slate-300 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div className="mt-1.5 rounded-[13px] border border-emerald-100 bg-emerald-50 p-3">
                    {([['काय आहे', what], ['काय करायचं', act], ['का?', why]] as [string, string][]).map(([k, v], i) => (
                        <div key={k} className={`flex gap-2.5 ${i > 0 ? 'mt-2.5 border-t border-emerald-100 pt-2.5' : ''}`}>
                            <span className="w-[76px] flex-shrink-0 pt-px text-[11px] font-extrabold leading-snug text-emerald-700">{k}</span>
                            <span className="flex-1 text-[12.5px] font-semibold leading-snug text-slate-700">{v}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
