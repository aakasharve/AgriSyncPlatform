/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 6 — extracted from ProfilePage.tsx.
 *
 * Tab strip + collapse toggle. Encapsulates `TabItem` and the optional
 * Finance / Referrals "rail" entries.
 */

import React from 'react';
import {
    ArrowRight,
    BarChart3,
    BrainCircuit,
    ChevronRight,
    FlaskConical,
    Medal,
    PanelLeftClose,
    PanelLeftOpen,
    Sprout,
    Tractor,
    User,
    Zap,
} from 'lucide-react';
import { useLanguage } from '../../../i18n/LanguageContext';
import type { ProfileTab } from '../ProfilePage';

interface TabItemProps {
    id: ProfileTab;
    label: string;
    icon: React.ReactNode;
    activeTab: ProfileTab;
    onSelect: (id: ProfileTab) => void;
    sidebarCollapsed: boolean;
}

const TabItem: React.FC<TabItemProps> = ({ id, label, icon, activeTab, onSelect, sidebarCollapsed }) => {
    const isActive = activeTab === id;
    return (
        <button
            onClick={() => onSelect(id)}
            title={sidebarCollapsed ? label : undefined}
            className={`flex items-center w-full rounded-xl text-left transition-all
                ${sidebarCollapsed ? 'lg:justify-center lg:p-2 gap-3 p-3' : 'gap-3 p-3'}
                ${isActive ? 'bg-emerald-50 text-emerald-800 border border-emerald-100 shadow-sm' : 'text-slate-500 hover:bg-white'}`}
        >
            <div className={`${isActive ? 'text-emerald-600' : 'text-slate-400'}`}>{icon}</div>
            <span className={`text-sm font-bold ${sidebarCollapsed ? 'lg:hidden' : ''}`}>{label}</span>
            {isActive && !sidebarCollapsed && <ChevronRight size={16} className="ml-auto text-emerald-400 hidden lg:block" />}
            {isActive && !sidebarCollapsed && <ChevronRight size={16} className="ml-auto text-emerald-400 lg:hidden" />}
        </button>
    );
};

export interface ProfileSidebarProps {
    activeTab: ProfileTab;
    onSelectTab: (tab: ProfileTab) => void;
    sidebarCollapsed: boolean;
    onToggleCollapsed: () => void;
    onOpenFinanceManager?: () => void;
    onOpenReferrals?: () => void;
}

export const ProfileSidebar: React.FC<ProfileSidebarProps> = ({
    activeTab,
    onSelectTab,
    sidebarCollapsed,
    onToggleCollapsed,
    onOpenFinanceManager,
    onOpenReferrals,
}) => {
    const { t } = useLanguage();

    return (
        <div className={`w-full flex-shrink-0 transition-[width] duration-200 ${sidebarCollapsed ? 'lg:w-16' : 'lg:w-64'}`}>
            <div className="bg-slate-50/50 p-2 rounded-2xl border border-slate-200 space-y-1">
                <div className="flex items-center justify-between">
                    <div className={`px-3 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
                        {t('profile.setupHub')}
                    </div>
                    <button
                        type="button"
                        onClick={onToggleCollapsed}
                        title={sidebarCollapsed ? 'Expand menu' : 'Collapse menu'}
                        aria-label={sidebarCollapsed ? 'Expand menu' : 'Collapse menu'}
                        className="hidden lg:inline-flex items-center justify-center ml-auto mr-1 h-8 w-8 rounded-lg text-slate-400 hover:bg-white hover:text-emerald-600 transition-colors"
                    >
                        {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
                    </button>
                </div>

                <TabItem id="identity" label={t('profile.farmerIdentity')} icon={<User size={20} />} activeTab={activeTab} onSelect={onSelectTab} sidebarCollapsed={sidebarCollapsed} />
                <TabItem id="structure" label={t('profile.cropsAndPlots')} icon={<Sprout size={20} />} activeTab={activeTab} onSelect={onSelectTab} sidebarCollapsed={sidebarCollapsed} />
                <TabItem id="utils" label={t('profile.waterAndPower')} icon={<Zap size={20} />} activeTab={activeTab} onSelect={onSelectTab} sidebarCollapsed={sidebarCollapsed} />
                <TabItem id="machines" label={t('profile.machinery')} icon={<Tractor size={20} />} activeTab={activeTab} onSelect={onSelectTab} sidebarCollapsed={sidebarCollapsed} />
                <TabItem id="health" label="Soil & Crop Health" icon={<FlaskConical size={20} />} activeTab={activeTab} onSelect={onSelectTab} sidebarCollapsed={sidebarCollapsed} />
                <TabItem id="intelligence" label={t('profile.intelligence')} icon={<BrainCircuit size={20} />} activeTab={activeTab} onSelect={onSelectTab} sidebarCollapsed={sidebarCollapsed} />

                <div className={`px-3 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider mt-4 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>Finance</div>
                <button
                    onClick={onOpenFinanceManager}
                    title={sidebarCollapsed ? 'Finance Manager' : undefined}
                    className={`flex items-center w-full rounded-xl text-left text-slate-500 hover:bg-white hover:text-emerald-700 transition-all group
                        ${sidebarCollapsed ? 'lg:justify-center lg:p-2 gap-3 p-3' : 'gap-3 p-3'}`}
                >
                    <div className="text-slate-400 group-hover:text-emerald-600"><BarChart3 size={20} /></div>
                    <span className={`text-sm font-bold ${sidebarCollapsed ? 'lg:hidden' : ''}`}>Finance Manager</span>
                    <ArrowRight size={16} className={`ml-auto text-slate-300 group-hover:text-emerald-400 ${sidebarCollapsed ? 'lg:hidden' : ''}`} />
                </button>

                {onOpenReferrals && (
                    <>
                        <div className={`px-3 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider mt-4 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>Growth</div>
                        <button
                            onClick={onOpenReferrals}
                            title={sidebarCollapsed ? 'Referrals & Benefits' : undefined}
                            className={`flex items-center w-full rounded-xl text-left text-slate-500 hover:bg-white hover:text-emerald-700 transition-all group
                                ${sidebarCollapsed ? 'lg:justify-center lg:p-2 gap-3 p-3' : 'gap-3 p-3'}`}
                        >
                            <div className="text-slate-400 group-hover:text-emerald-600"><Medal size={20} /></div>
                            <div className={`min-w-0 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
                                <span className="text-sm font-bold">रेफरल्स · Referrals</span>
                                <span className="block text-[10px] text-slate-400">& Benefits</span>
                            </div>
                            <ArrowRight size={16} className={`ml-auto text-slate-300 group-hover:text-emerald-400 ${sidebarCollapsed ? 'lg:hidden' : ''}`} />
                        </button>
                    </>
                )}
            </div>
        </div>
    );
};
