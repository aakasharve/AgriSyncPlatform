/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SetupHubMenu — the Profile as a simple account-style menu (variation of the
 * accordion). A profile summary + soft rounded row-cards; each row opens its
 * own section page (handled by ProfilePage). A labelled back exits Profile.
 * Built for a semi-literate farmer: one clear list, big rows, status hints.
 */
import React from 'react';
import { ChevronRight, ArrowLeft, CheckCircle2, MapPin, LogOut, BarChart3, Medal } from 'lucide-react';
import type { ProfileTab } from '../ProfilePage';
import type { MyFarmDto } from '../../onboarding/qr/inviteApi';
import FarmsSection from './FarmsSection';

export interface HubMenuItem {
    id: ProfileTab;
    label: string;
    icon: React.ReactNode;
    subtitle?: string;
    done?: boolean;
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
    items: HubMenuItem[];
    onSelect: (id: ProfileTab) => void;
    onExit?: () => void;
    onOpenFinance?: () => void;
    onOpenReferrals?: () => void;
    settingsItems?: { id: string; label: string; icon: React.ReactNode; subtitle?: string }[];
    onSelectExtra?: (id: string) => void;
    logout: () => void;
}

const GroupLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="mb-2.5 mt-5 px-1 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">{children}</div>
);

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
    farmerName, verified, farmName, farms, familyName, onOpenFarm, onAddFarm, language, items, onSelect, onExit, onOpenFinance, onOpenReferrals, settingsItems, onSelectExtra, logout,
}) => {
    return (
        <div>
            {/* header — light, blended into the page (no hard white banner) */}
            <div className="sticky top-0 z-10 -mx-4 mb-2 flex items-center gap-3 bg-gradient-to-b from-[#f6f7f5] via-[#f6f7f5]/95 to-[#f6f7f5]/0 px-4 pb-4 pt-1 sm:-mx-6 sm:px-6">
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

            {/* farm-setup sections */}
            <GroupLabel>शेती सेटअप · Farm setup</GroupLabel>
            <div className="space-y-2.5">
                {items.map(it => (
                    <RowCard key={it.id} icon={it.icon} label={it.label} subtitle={it.subtitle} tone={it.done ? 'emerald' : 'muted'} onClick={() => onSelect(it.id)} />
                ))}
            </div>

            {/* more */}
            <GroupLabel>अधिक · More</GroupLabel>
            <div className="space-y-2.5">
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
