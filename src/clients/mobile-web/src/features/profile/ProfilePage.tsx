/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 6 — ProfilePage orchestrator (≤ 250 lines per DoD).
 *
 * Owns the tab state + the modal portal. Section bodies live in
 * ./sections/<X>Section.tsx. State logic lives in ./hooks (useCropPlotState,
 * useFarmAdminState). Sidebar + boundary modals live in ./components.
 */

import React, { useState, useEffect, useRef } from 'react';
import { User, Sprout, Zap, Tractor, FlaskConical, ArrowLeft, Globe, Shield, Mic } from 'lucide-react';
import { idGenerator } from '../../core/domain/services/IdGenerator';
import { useLanguage } from '../../i18n/LanguageContext';
import { useAuth } from '../../app/providers/AuthProvider';
import { useFarmContext } from '../../core/session/FarmContext';
import { useWorkerProfile } from '../work/hooks/useWorkerProfile';
import { AddMemberWizard } from '../people/components/AddMemberWizard';
import FarmInviteQrSheet from '../onboarding/qr/FarmInviteQrSheet';

import IdentitySection from './sections/IdentitySection';
import StructureSection from './sections/StructureSection';
import UtilitiesSection from './sections/UtilitiesSection';
import MachinesSection from './sections/MachinesSection';
import HealthSection from './sections/HealthSection';
import AddPlotWizard from './components/AddPlotWizard';
import { BoundaryMapModal } from './components/BoundaryMapModal';
import type { HubSection } from './components/SetupHubAccordion';
import { SetupHubMenu, type HubMenuItem } from './components/SetupHubMenu';
import { useCropPlotState } from './hooks/useCropPlotState';
import { useFarmAdminState } from './hooks/useFarmAdminState';

import type { CropProfile, FarmerProfile, FarmOperator, Person } from '../../types';

/**
 * The eight tabs rendered by ProfilePage. Exported so tests (and any
 * future deep-link helper) can address tabs without re-declaring the
 * literal union.
 */
export type ProfileTab =
    | 'identity'
    | 'structure'
    | 'utils'
    | 'plan'
    | 'machines'
    | 'health'
    | 'intelligence'
    | 'people';

interface ProfilePageProps {
    profile: FarmerProfile;
    crops: CropProfile[];
    onUpdateProfile: (p: FarmerProfile) => void;
    onUpdateCrops: (c: CropProfile[]) => void;
    waterResources?: unknown;
    electricity?: unknown;
    onAddPerson?: (person: Person) => void;
    onDeletePerson?: (id: string) => void;
    onOpenScheduleLibrary?: (cropId?: string) => void;
    onOpenFinanceManager?: () => void;
    onOpenReferrals?: () => void;
    onOpenQrDemo?: () => void;
    /** Leave the Profile screen (back to the main app / daily log). */
    onExit?: () => void;
    /**
     * Test-only seam: lets snapshot tests render each tab deterministically
     * without simulating a click. Removed in Sub-plan 04 Task 6 once tabs
     * become route segments. Falls through to 'structure' (the production
     * default) when undefined.
     */
    initialTab?: ProfileTab;
}

const ProfilePage: React.FC<ProfilePageProps> = ({
    profile, crops, onUpdateProfile, onUpdateCrops,
    onAddPerson, onDeletePerson,
    onOpenScheduleLibrary, onOpenFinanceManager, onOpenReferrals,
    onExit,
    initialTab,
}) => {
    const { logout, session: authSession } = useAuth();
    const { t, language, setLanguage } = useLanguage();
    // null = the Profile menu; a tab = that section's own page (with a back arrow).
    const [activeTab, setActiveTab] = useState<ProfileTab | null>(initialTab ?? null);
    // extra (settings) pages folded into Profile — e.g. 'language'.
    const [activeExtra, setActiveExtra] = useState<string | null>(null);

    const cropPlot = useCropPlotState({ crops, onUpdateCrops });
    const farmAdmin = useFarmAdminState();

    // Deep-link handoff: a "set boundary" tap elsewhere (e.g. the weather
    // caution) sets sessionStorage 'open_farm_boundary'. Consume it once here to
    // open the Draw-Farm-Boundary drawer on the Identity tab. Two effects so the
    // drawer only opens after the lazily-loaded farm resolves.
    const { myFarm: adminMyFarm, setShowFarmBoundary: adminSetShowFarmBoundary } = farmAdmin;
    const pendingOpenBoundary = useRef(false);
    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (window.sessionStorage.getItem('open_farm_boundary')) {
            window.sessionStorage.removeItem('open_farm_boundary');
            setActiveTab('identity');
            pendingOpenBoundary.current = true;
        }
    }, []);
    useEffect(() => {
        if (pendingOpenBoundary.current && adminMyFarm) {
            pendingOpenBoundary.current = false;
            adminSetShowFarmBoundary(true);
        }
    }, [adminMyFarm, adminSetShowFarmBoundary]);

    const [showMemberWizard, setShowMemberWizard] = useState(false);
    const handleAddMember = (member: Partial<FarmOperator>) => {
        if (onAddPerson) {
            onAddPerson({ ...(member as unknown as Person), id: `p_${idGenerator.generate()}` });
        }
        setShowMemberWizard(false);
    };

    // CEI Phase 4 §4.8 — show own reliability score if user is a Worker or
    // Mukadam on any farm.
    const { currentFarmId: profileFarmId, switchFarm } = useFarmContext();
    const isWorkerOnAnyFarm = farmAdmin.myMemberships.some(m => m.role === 'Worker' || m.role === 'Mukadam');
    const { profile: workerProfile } = useWorkerProfile(
        isWorkerOnAnyFarm ? (authSession?.userId ?? null) : null,
        profileFarmId,
    );
    const nonExitableFarmIds = React.useMemo(() => {
        const ids = new Set<string>();
        for (const m of farmAdmin.myMemberships) {
            if (m.role === 'PrimaryOwner') ids.add(m.farmId);
        }
        return ids;
    }, [farmAdmin.myMemberships]);

    // Open a specific farm: switch app-wide farm context to it, sync the
    // local farm-admin snapshot, and drill into its own page (Identity).
    const handleOpenFarm = React.useCallback((farmId: string) => {
        switchFarm(farmId);
        const picked = farmAdmin.myMemberships.find(m => m.farmId === farmId);
        if (picked) {
            farmAdmin.setMyFarm({ farmId: picked.farmId, name: picked.name, role: picked.role, subscription: picked.subscription ?? null });
        }
        setActiveTab('identity');
    }, [switchFarm, farmAdmin]);

    // Guided-setup progress: a section counts as "done" once its core data
    // exists. Identity = name + village; Crops = at least one crop. The rest
    // are refined as their completion signals are wired.
    const doneIds = React.useMemo(() => {
        const s = new Set<ProfileTab>();
        if (profile.name && profile.village) s.add('identity');
        if (crops.length > 0) s.add('structure');
        return s;
    }, [profile.name, profile.village, crops.length]);

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-4 pb-[calc(8rem+env(safe-area-inset-bottom))]">
            {showMemberWizard && (
                <AddMemberWizard
                    onSave={handleAddMember}
                    onCancel={() => setShowMemberWizard(false)}
                />
            )}

            {farmAdmin.myFarm && (
                <FarmInviteQrSheet
                    isOpen={farmAdmin.showInviteQr}
                    onClose={() => farmAdmin.setShowInviteQr(false)}
                    farmId={farmAdmin.myFarm.farmId}
                    farmName={farmAdmin.myFarm.name}
                />
            )}
            {farmAdmin.farmLookupError && farmAdmin.showInviteQr === false && (
                <div className="fixed bottom-24 left-1/2 -translate-x-1/2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 shadow-lg z-50">
                    {farmAdmin.farmLookupError}
                </div>
            )}

            {cropPlot.wizardCropId && (
                <AddPlotWizard
                    crop={crops.find(c => c.id === cropPlot.wizardCropId)!}
                    profile={profile}
                    onSave={cropPlot.handleAddPlot}
                    onCancel={() => cropPlot.setWizardCropId(null)}
                />
            )}

            {cropPlot.mappingPlotId && (() => {
                const activeCrop = crops.find(c => c.id === cropPlot.mappingPlotId!.cropId);
                const activePlot = activeCrop?.plots.find(p => p.id === cropPlot.mappingPlotId!.plotId);
                return (
                    <BoundaryMapModal
                        headerCaption={`${activeCrop?.name || 'Crop'} · ${activePlot?.name || 'Plot'}`}
                        headerTitle="Draw plot boundary"
                        onClose={() => cropPlot.setMappingPlotId(null)}
                        onPlotComplete={(geoData) => cropPlot.handleSaveMap(cropPlot.mappingPlotId!.cropId, cropPlot.mappingPlotId!.plotId, geoData)}
                        onDone={() => cropPlot.setMappingPlotId(null)}
                        existingGeoData={activePlot?.geoData}
                    />
                );
            })()}

            {farmAdmin.showFarmBoundary && farmAdmin.myFarm && (
                <BoundaryMapModal
                    headerCaption={`Farm · ${farmAdmin.myFarm.name}`}
                    headerTitle="Draw farm boundary"
                    onClose={() => { farmAdmin.setShowFarmBoundary(false); farmAdmin.setBoundaryError(null); }}
                    onPlotComplete={farmAdmin.handleSaveFarmBoundary}
                    onDone={farmAdmin.handleFinishFarmBoundary}
                    closeDisabled={farmAdmin.savingBoundary}
                    error={farmAdmin.boundaryError}
                />
            )}

            {(() => {
                const sections: HubSection[] = [
                    {
                        id: 'identity',
                        label: t('profile.farmerIdentity'),
                        icon: <User size={20} />,
                        body: (
                            <IdentitySection
                                profile={profile}
                                onUpdateProfile={onUpdateProfile}
                                onDeletePerson={onDeletePerson}
                                logout={logout}
                                myFarm={farmAdmin.myFarm}
                                myMemberships={farmAdmin.myMemberships}
                                farmDetails={farmAdmin.farmDetails}
                                weatherConnected={farmAdmin.weatherConnected}
                                connectingWeather={farmAdmin.connectingWeather}
                                connectError={farmAdmin.connectError}
                                handleConnectWeather={farmAdmin.handleConnectWeather}
                                setShowFarmBoundary={farmAdmin.setShowFarmBoundary}
                                handleOpenInviteQr={farmAdmin.handleOpenInviteQr}
                                setShowMemberWizard={setShowMemberWizard}
                                nonExitableFarmIds={nonExitableFarmIds}
                                handleExitMembership={farmAdmin.handleExitMembership}
                                isWorkerOnAnyFarm={isWorkerOnAnyFarm}
                                workerProfile={workerProfile}
                            />
                        ),
                    },
                    {
                        id: 'structure',
                        label: t('profile.cropsAndPlots'),
                        icon: <Sprout size={20} />,
                        body: (
                            <StructureSection
                                crops={crops}
                                isAddingCrop={cropPlot.isAddingCrop}
                                setIsAddingCrop={cropPlot.setIsAddingCrop}
                                newCropData={cropPlot.newCropData}
                                setNewCropData={cropPlot.setNewCropData}
                                cropNameError={cropPlot.cropNameError}
                                setCropNameError={cropPlot.setCropNameError}
                                normalizeCropName={cropPlot.normalizeCropName}
                                normalizedNewCropName={cropPlot.normalizedNewCropName}
                                isDuplicateCropName={cropPlot.isDuplicateCropName}
                                handleAddCrop={cropPlot.handleAddCrop}
                                setMappingPlotId={cropPlot.setMappingPlotId}
                                deletePlot={cropPlot.deletePlot}
                                setWizardCropId={cropPlot.setWizardCropId}
                                onOpenScheduleLibrary={onOpenScheduleLibrary}
                            />
                        ),
                    },
                    { id: 'utils', label: t('profile.waterAndPower'), icon: <Zap size={20} />, body: <UtilitiesSection profile={profile} onUpdate={onUpdateProfile} /> },
                    { id: 'machines', label: t('profile.machinery'), icon: <Tractor size={20} />, body: <MachinesSection profile={profile} onUpdate={onUpdateProfile} /> },
                    { id: 'health', label: 'माती व पीक आरोग्य · Soil & Crop Health', icon: <FlaskConical size={20} />, body: <HealthSection profile={profile} onUpdate={onUpdateProfile} /> },
                ];

                const subtitleFor = (id: ProfileTab): string => {
                    if (id === 'identity') return doneIds.has('identity') ? 'माहिती भरली · Details filled' : 'माहिती भरा · Fill details';
                    if (id === 'structure') return crops.length > 0 ? `${crops.length} प्लॉट · plots` : 'पिके जोडा · Add crops';
                    if (id === 'utils') return 'विहीर, मोटर, वीज · Water & power';
                    if (id === 'machines') return 'यंत्रे जोडा · Add machinery';
                    if (id === 'health') return 'माती अहवाल · Soil reports';
                    return '';
                };
                const menuItems: HubMenuItem[] = sections.map(s => ({ id: s.id, label: s.label, icon: s.icon, subtitle: subtitleFor(s.id), done: doneIds.has(s.id) }));

                const langLabel = language === 'mr' ? 'मराठी' : 'English';
                const settingsItems = [
                    { id: 'language', label: 'भाषा · Language', icon: <Globe size={20} />, subtitle: langLabel },
                    { id: 'permissions', label: 'अ‍ॅप परवानग्या · App permissions', icon: <Shield size={20} />, subtitle: 'GPS · Mic · Camera' },
                    { id: 'voice', label: 'आवाज डायरी · Voice diary', icon: <Mic size={20} /> },
                ];

                // shared compact header with a clearly-labelled back button
                const header = (title: string, onBack: () => void) => (
                    <div className="sticky top-0 z-10 -mx-4 mb-3 flex items-center gap-3 bg-gradient-to-b from-[#f6f7f5] via-[#f6f7f5]/95 to-[#f6f7f5]/0 px-4 pb-4 pt-1 sm:-mx-6 sm:px-6">
                        <button type="button" onClick={onBack} className="flex items-center gap-1.5 rounded-full bg-white py-2 pl-2.5 pr-3.5 text-[13px] font-bold text-slate-700 shadow-sm ring-1 ring-slate-100 transition-all active:scale-95">
                            <ArrowLeft size={16} /> मागे
                        </button>
                        <div className="flex-1 truncate pr-16 text-center text-[14px] font-bold text-slate-800">{title}</div>
                    </div>
                );

                if (activeExtra === 'language') {
                    const langs: { code: 'mr' | 'en'; native: string; label: string }[] = [
                        { code: 'mr', native: 'मराठी', label: 'Marathi' },
                        { code: 'en', native: 'English', label: 'English' },
                    ];
                    return (
                        <div>
                            {header('भाषा · Language', () => setActiveExtra(null))}
                            <p className="mb-3 px-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">भाषा निवडा · Choose language</p>
                            <div className="space-y-2.5">
                                {langs.map(l => (
                                    <button key={l.code} type="button" onClick={() => setLanguage(l.code)}
                                        className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition-all active:scale-[0.98] ${language === l.code ? 'border-emerald-300 bg-emerald-50 shadow-sm' : 'border-slate-200 bg-white'}`}>
                                        <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${language === l.code ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-400'}`}><Globe size={20} /></span>
                                        <span className="flex-1"><span className="block text-[15px] font-bold text-slate-800">{l.native}</span><span className="block text-[11px] text-slate-400">{l.label}</span></span>
                                        {language === l.code && <span className="text-xs font-bold text-emerald-700">निवडले ✓</span>}
                                    </button>
                                ))}
                            </div>
                        </div>
                    );
                }
                if (activeExtra) {
                    const extraTitle = activeExtra === 'permissions' ? 'अ‍ॅप परवानग्या · App permissions' : 'आवाज डायरी · Voice diary';
                    return (
                        <div>
                            {header(extraTitle, () => setActiveExtra(null))}
                            <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-10 text-center">
                                <p className="text-sm font-semibold text-slate-400">लवकरच येत आहे · Coming soon</p>
                            </div>
                        </div>
                    );
                }

                const current = activeTab ? sections.find(s => s.id === activeTab) : undefined;
                if (!current) {
                    return (
                        <SetupHubMenu
                            farmerName={profile.name ?? ''}
                            verified={doneIds.has('identity')}
                            farmName={farmAdmin.myFarm?.name ?? undefined}
                            farms={farmAdmin.myMemberships}
                            familyName={profile.name ? `${profile.name.split(' ')[0]} कुटुंब` : undefined}
                            onOpenFarm={handleOpenFarm}
                            language={language}
                            items={menuItems}
                            onSelect={setActiveTab}
                            onExit={onExit}
                            onOpenFinance={onOpenFinanceManager}
                            onOpenReferrals={onOpenReferrals}
                            settingsItems={settingsItems}
                            onSelectExtra={setActiveExtra}
                            logout={logout}
                        />
                    );
                }
                return (
                    <div>
                        {header(current.label, () => setActiveTab(null))}
                        {current.body}
                    </div>
                );
            })()}
        </div>
    );
};

export default ProfilePage;
