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

import React, { useState } from 'react';
import { idGenerator } from '../../core/domain/services/IdGenerator';
import { useUiPref } from '../../shared/hooks/useUiPref';
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
import IntelligenceSection from './sections/IntelligenceSection';
import AddPlotWizard from './components/AddPlotWizard';
import { BoundaryMapModal } from './components/BoundaryMapModal';
import { ProfileSidebar } from './components/ProfileSidebar';
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
    initialTab,
}) => {
    const { logout, session: authSession } = useAuth();
    const [activeTab, setActiveTab] = useState<ProfileTab>(initialTab ?? 'structure');
    const [sidebarCollapsed, setSidebarCollapsed] = useUiPref<boolean>('shramsafal_setup_sidebar_collapsed', false);

    const cropPlot = useCropPlotState({ crops, onUpdateCrops });
    const farmAdmin = useFarmAdminState();

    const [showMemberWizard, setShowMemberWizard] = useState(false);
    const handleAddMember = (member: Partial<FarmOperator>) => {
        if (onAddPerson) {
            onAddPerson({ ...(member as unknown as Person), id: `p_${idGenerator.generate()}` });
        }
        setShowMemberWizard(false);
    };

    // CEI Phase 4 §4.8 — show own reliability score if user is a Worker or
    // Mukadam on any farm.
    const { currentFarmId: profileFarmId } = useFarmContext();
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

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-4 pb-32">
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

            <div className="flex flex-col lg:flex-row gap-6">
                <ProfileSidebar
                    activeTab={activeTab}
                    onSelectTab={setActiveTab}
                    sidebarCollapsed={sidebarCollapsed}
                    onToggleCollapsed={() => setSidebarCollapsed(!sidebarCollapsed)}
                    onOpenFinanceManager={onOpenFinanceManager}
                    onOpenReferrals={onOpenReferrals}
                />

                <div className="flex-1 min-w-0">
                    {activeTab === 'identity' && (
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
                    )}

                    {activeTab === 'structure' && (
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
                    )}

                    {activeTab === 'utils' && <UtilitiesSection profile={profile} onUpdate={onUpdateProfile} />}
                    {activeTab === 'machines' && <MachinesSection profile={profile} onUpdate={onUpdateProfile} />}
                    {activeTab === 'health' && <HealthSection profile={profile} onUpdate={onUpdateProfile} />}
                    {activeTab === 'intelligence' && <IntelligenceSection />}
                </div>
            </div>
        </div>
    );
};

export default ProfilePage;
