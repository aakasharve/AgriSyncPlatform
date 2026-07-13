/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SetupHubMenu — the Profile as a simple account-style menu. A profile
 * summary, a farm-setup progress card (real % from the farmer's data), the
 * farms list, and the setup sections as clean rows — each with a status
 * badge and a discreet "?" that opens a short, plain-language guide.
 * Built for a semi-literate farmer: one clear list, big rows, plain words.
 */
import React, { useState } from 'react';
import { ChevronRight, ArrowLeft, CheckCircle2, Check, MapPin, LogOut, BarChart3, Medal, Users } from 'lucide-react';
import type { ProfileTab } from '../ProfilePage';
import type { MyFarmDto } from '../../onboarding/qr/inviteApi';
import FarmsSection from './FarmsSection';

export interface SetupHelp {
    what: string;
    do: string;
    why: string;
}

export interface HubMenuItem {
    id: ProfileTab;
    label: string;
    icon: React.ReactNode;
    subtitle?: string;
    done?: boolean;
    help?: SetupHelp;
}

export interface SetupProgressData {
    done: number;
    total: number;
    percent: number;
    nextId?: ProfileTab;
    nextLabel?: string;
}

interface SetupHubMenuProps {
    farmerName: string;
    verified: boolean;
    farmName?: string;
    farms?: MyFarmDto[];
    familyName?: string;
    onOpenFarm?: (farmId: string) => void;
    onAddFarm?: () => void;
    language?: 'mr' | 'en';
    setupProgress?: SetupProgressData;
    items: HubMenuItem[];
    onSelect: (id: ProfileTab) => void;
    onExit?: () => void;
    onOpenFinance?: () => void;
    onOpenLabour?: () => void;
    onOpenReferrals?: () => void;
    settingsItems?: { id: string; label: string; icon: React.ReactNode; subtitle?: string }[];
    onSelectExtra?: (id: string) => void;
    logout: () => void;
}

const GroupLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="mb-2.5 mt-5 px-1 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">{children}</div>
);

/** Farm-setup progress card — one honest bar over the setup sections. */
const ProgressHero: React.FC<{ p: SetupProgressData; onNext: () => void }> = ({ p, onNext }) => (
    <div className="relative mt-2 overflow-hidden rounded-[26px] border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-white p-5 shadow-[0_16px_32px_-22px_rgba(5,150,105,0.4)]">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-emerald-600">शेती तयारी · Farm setup</div>
        <div className="mt-1.5 flex items-end gap-2.5">
            <div className="text-[44px] font-black leading-[0.9] tracking-tight text-emerald-700 [font-variant-numeric:tabular-nums]">{p.percent}%</div>
            <div className="pb-1.5 text-[12px] font-bold leading-tight text-slate-500">{p.done} पैकी {p.total} पूर्ण<br />{p.done} of {p.total} complete</div>
        </div>
        <div className="relative mt-3.5 h-2.5 overflow-hidden rounded-full bg-emerald-100">
            <span className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-[width] duration-500" style={{ width: `${p.percent}%` }} />
        </div>
        {p.done < p.total && p.nextLabel ? (
            <div className="mt-3.5 flex items-center gap-2 text-[12.5px] text-slate-600">
                <span className="truncate">पुढे · Next: <b className="font-extrabold text-emerald-800">{p.nextLabel}</b></span>
                <button type="button" onClick={onNext} className="ml-auto flex flex-shrink-0 items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 py-1.5 text-[11.5px] font-extrabold text-white shadow-[0_6px_14px_-6px_rgba(5,150,105,0.6)] transition-transform active:scale-95">
                    सुरू करा <ChevronRight size={13} />
                </button>
            </div>
        ) : (
            <div className="mt-3.5 flex items-center gap-1.5 text-[12.5px] font-bold text-emerald-700"><CheckCircle2 size={15} /> सर्व पूर्ण! छान काम.</div>
        )}
    </div>
);

/** One setup section: clean row + status badge + a "?" that opens simple help. */
const SetupRow: React.FC<{ item: HubMenuItem; isNext: boolean; onSelect: () => void }> = ({ item, isNext, onSelect }) => {
    const [open, setOpen] = useState(false);
    const done = !!item.done;
    const tile = done ? 'bg-emerald-50 text-emerald-600'
        : isNext ? 'bg-emerald-600 text-white shadow-[0_8px_16px_-8px_rgba(5,150,105,0.6)]'
            : 'bg-slate-50 text-slate-400 ring-1 ring-slate-100';
    return (
        <div className={`overflow-hidden rounded-[18px] border bg-white shadow-[0_1px_2px_rgba(20,40,30,0.05)] ${isNext ? 'border-emerald-200 border-l-[3px] border-l-emerald-600 shadow-[0_14px_26px_-18px_rgba(5,150,105,0.4)]' : 'border-slate-100'}`}>
            <div className="flex items-center gap-3 p-3.5">
                <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-3.5 text-left transition-transform active:scale-[0.99]">
                    <span className={`relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[13px] ${tile}`}>
                        {item.icon}
                        {done && <span className="absolute -bottom-1 -right-1 flex h-[19px] w-[19px] items-center justify-center rounded-full border-2 border-white bg-emerald-600 text-white"><Check size={11} strokeWidth={3} /></span>}
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-bold text-slate-800">{item.label}</span>
                        {item.subtitle && <span className={`mt-0.5 block truncate text-[11.5px] ${isNext ? 'font-semibold text-emerald-700' : 'text-slate-400'}`}>{item.subtitle}</span>}
                    </span>
                </button>
                <span className={`flex-shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-extrabold tracking-wide ${done ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>{done ? 'पूर्ण' : 'बाकी'}</span>
                {item.help && (
                    <button type="button" aria-label="मदत · help" aria-expanded={open} onClick={() => setOpen(o => !o)}
                        className={`flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full border font-serif text-[14px] font-bold transition-all active:scale-90 ${open ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 bg-white text-slate-500'}`}>?</button>
                )}
            </div>
            {open && item.help && (
                <div className="px-3.5 pb-3.5 pl-[73px]">
                    <div className="rounded-[13px] border border-emerald-100 bg-emerald-50 p-3">
                        {([['काय आहे', item.help.what], ['काय करायचं', item.help.do], ['का?', item.help.why]] as [string, string][]).map(([k, v], i) => (
                            <div key={k} className={`flex gap-2.5 ${i > 0 ? 'mt-2.5 border-t border-emerald-100 pt-2.5' : ''}`}>
                                <span className="w-[76px] flex-shrink-0 pt-px text-[11px] font-extrabold leading-snug text-emerald-700">{k}</span>
                                <span className="flex-1 text-[12.5px] font-semibold leading-snug text-slate-700">{v}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

interface RowCardProps {
    icon: React.ReactNode;
    label: string;
    subtitle?: string;
    tone?: 'emerald' | 'muted' | 'danger';
    onClick?: () => void;
}
const RowCard: React.FC<RowCardProps> = ({ icon, label, subtitle, tone = 'muted', onClick }) => {
    const tileTone =
        tone === 'emerald' ? 'bg-emerald-50 text-emerald-600 ring-emerald-100'
            : tone === 'danger' ? 'bg-red-50 text-red-500 ring-red-100'
                : 'bg-slate-50 text-slate-400 ring-slate-100';
    return (
        <button
            type="button"
            onClick={onClick}
            className="group flex w-full items-center gap-3.5 rounded-[20px] border border-slate-100 bg-white p-3.5 text-left shadow-[0_1px_3px_rgba(20,40,30,0.05)] transition-all active:scale-[0.98] hover:border-emerald-200/70 hover:shadow-[0_6px_16px_-8px_rgba(20,40,30,0.18)]"
        >
            <span className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl ring-1 ${tileTone}`}>{icon}</span>
            <span className="min-w-0 flex-1">
                <span className={`block truncate text-[15px] font-bold ${tone === 'danger' ? 'text-red-500' : 'text-slate-800'}`}>{label}</span>
                {subtitle && <span className={`mt-0.5 block truncate text-[11.5px] ${tone === 'emerald' ? 'font-semibold text-emerald-700' : 'text-slate-400'}`}>{subtitle}</span>}
            </span>
            {tone !== 'danger' && <ChevronRight size={18} className="flex-shrink-0 text-slate-300 transition-transform group-active:translate-x-0.5" />}
        </button>
    );
};

export const SetupHubMenu: React.FC<SetupHubMenuProps> = ({
    farmerName, verified, farmName, farms, familyName, onOpenFarm, onAddFarm, language, setupProgress, items, onSelect, onExit, onOpenFinance, onOpenLabour, onOpenReferrals, settingsItems, onSelectExtra, logout,
}) => {
    return (
        <div>
            {/* header — solid band so nothing shows through behind the back button */}
            <div className="sticky top-0 z-20 -mx-4 mb-2 flex items-center gap-3 bg-[#f6f7f5] px-4 pb-3 pt-2 shadow-[0_8px_14px_-12px_rgba(20,40,30,0.35)] sm:-mx-6 sm:px-6">
                {onExit && (
                    <button
                        type="button"
                        onClick={onExit}
                        className="flex items-center gap-1.5 rounded-full bg-white py-2 pl-2.5 pr-3.5 text-[13px] font-bold text-slate-700 shadow-sm ring-1 ring-slate-100 transition-all active:scale-95"
                    >
                        <ArrowLeft size={16} /> मागे
                    </button>
                )}
                <div className="flex-1 truncate pr-16 text-center text-[13px] font-bold uppercase tracking-wide text-slate-400">प्रोफाइल · Profile</div>
            </div>

            {/* profile summary */}
            <div className="mb-2 flex items-center gap-4 rounded-[26px] border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-white p-4 shadow-[0_4px_20px_-12px_rgba(5,150,105,0.35)]">
                <div className="relative flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full border-[3px] border-white bg-white text-3xl shadow-md shadow-emerald-200/50">
                    👨‍🌾
                    {verified && (
                        <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-emerald-600 text-white">
                            <CheckCircle2 size={14} />
                        </span>
                    )}
                </div>
                <div className="min-w-0">
                    <div className="truncate text-lg font-black leading-tight text-slate-800">{farmerName || '—'}</div>
                    {verified && (
                        <div className="mt-1 flex items-center gap-1 text-[11px] font-bold text-emerald-800">
                            <CheckCircle2 size={13} /> पडताळणी झाली · Verified
                        </div>
                    )}
                    {farmName && (
                        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
                            <MapPin size={13} /> {farmName}
                        </div>
                    )}
                </div>
            </div>

            {/* farm-setup progress — real % from the farmer's data */}
            {setupProgress && (
                <ProgressHero p={setupProgress} onNext={() => setupProgress.nextId && onSelect(setupProgress.nextId)} />
            )}

            {/* your farms — each a 7/12 holding; tap to open its own page */}
            {farms && farms.length > 0 && onOpenFarm && (
                <FarmsSection
                    farms={farms}
                    familyName={familyName}
                    onOpenFarm={onOpenFarm}
                    onAddFarm={onAddFarm}
                    language={language ?? 'mr'}
                />
            )}

            {/* farm-setup sections — clean rows with status + "?" help */}
            <GroupLabel>शेती सेटअप · Farm setup</GroupLabel>
            <div className="space-y-2.5">
                {items.map(it => (
                    <SetupRow key={it.id} item={it} isNext={setupProgress?.nextId === it.id} onSelect={() => onSelect(it.id)} />
                ))}
            </div>

            {/* more */}
            <GroupLabel>अधिक · More</GroupLabel>
            <div className="space-y-2.5">
                {onOpenLabour && <RowCard icon={<Users size={20} />} label="कामगार व्यवस्थापन · Labour" subtitle="हजेरी · मजुरी · उचल" tone="emerald" onClick={onOpenLabour} />}
                <RowCard icon={<BarChart3 size={20} />} label="पैसे व हिशोब · Finance" onClick={onOpenFinance} />
                {onOpenReferrals && <RowCard icon={<Medal size={20} />} label="रेफरल्स · Referrals" onClick={onOpenReferrals} />}
            </div>

            {/* settings — folded into Profile so there's one place */}
            {settingsItems && settingsItems.length > 0 && (
                <>
                    <GroupLabel>सेटिंग्ज · Settings</GroupLabel>
                    <div className="space-y-2.5">
                        {settingsItems.map(it => (
                            <RowCard key={it.id} icon={it.icon} label={it.label} subtitle={it.subtitle} onClick={() => onSelectExtra?.(it.id)} />
                        ))}
                    </div>
                </>
            )}

            {/* logout */}
            <div className="mt-5">
                <RowCard icon={<LogOut size={20} />} label="बाहेर पडा · Log out" tone="danger" onClick={logout} />
            </div>
            <div className="h-4" />
        </div>
    );
};
