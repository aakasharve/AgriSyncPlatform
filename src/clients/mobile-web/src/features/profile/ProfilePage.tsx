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
import { User, Sprout, Zap, Tractor, FlaskConical, Globe, Shield, CreditCard, Mic, BookOpen, Check, Droplets, Settings2, Users } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext';
import { useAuth } from '../../app/providers/AuthProvider';
import { useFarmContext } from '../../core/session/FarmContext';
import { requestCreateFarmWizard, requestJoinFarm } from '../../app/hooks/useFarmContextState';
import { useWorkerProfile } from '../work/hooks/useWorkerProfile';
import FarmInviteQrSheet from '../onboarding/qr/FarmInviteQrSheet';

import IdentitySection from './sections/IdentitySection';
import StructureSection from './sections/StructureSection';
import UtilitiesSection from './sections/UtilitiesSection';
import MachinesSection from './sections/MachinesSection';
import HealthSection from './sections/HealthSection';
import AddPlotWizard from './components/AddPlotWizard';
import { BoundaryMapModal } from './components/BoundaryMapModal';
import { SetupHubMenu, type HubMenuItem } from './components/SetupHubMenu';
import { useCropPlotState } from './hooks/useCropPlotState';
import { useFarmAdminState } from './hooks/useFarmAdminState';
import SubscriptionCard from '../admin/billing/SubscriptionCard';
import { buildSettingsExtraIds, OFFLINE_NOTES_TITLE, PRIVACY_TITLE } from './settingsItems';
import { useWaitingDraftCount } from './hooks/useWaitingDraftCount';
import { useWaitingVoiceNotes } from '../voiceDiary/waiting/useWaitingVoiceNotes';
import { voiceNotesWords } from '../voiceDiary/waiting/voiceNotesWords';
import { waitingCounts } from '../../infrastructure/sync/waitingVoiceNotes';
import { useBackDismiss } from '../../core/navigation/useBackDismiss';
import { Chip, PageBar, SANS, Tap } from '../../shared/components/ui/placeUi';
import { useLabourPermissions } from './hooks/useLabourPermissions';
import { isOwnerTierRole } from './helpers/teamRoster';
import { AUTHORITY, holdsAuthority, isPrimaryAccountHolderRole } from '../../core/session/farmAuthorities';
import { seatDoors } from '../../core/session/seatDoors';
import { TeamPage } from './team/TeamPage';
import { ReminderSettingsPage } from '../plannedWork/reminders/ReminderSettingsPage';
import { plannedWorkWords } from '../plannedWork/plannedWorkWords';
import { TEAM_COPY } from './team/teamCopy';
import { BOTTOM_BAR_CLEARANCE } from '../../shared/utils/bottomBar';
import { splitRoster } from './team/teamModel';
import { HUB_STEP_ORDER, HUB_STEP_TAB, powerTimesSaved, teamSoloKey, teamStepOf, type HubStepId } from './hubSteps';
import { useSentInvitations } from './components/TeamFirstStepCard';
import { useFarmPlots } from './team/useFarmPlots';
import { InviteBuilderSheet } from '../invitations/InviteBuilderSheet';
import type { InvitationLabel } from '../invitations/personalInvitationClient';
import { useUiPref } from '../../shared/hooks/useUiPref';
import { PLOT_PENDING_WORDS, pendingPlots } from './sections/plotPending';
import { usePlotScheduleChoices } from '../scheduler/schedulePage/usePlotScheduleChoices';
import { getDateKey } from '../../core/domain/services/DateKeyService';
import { digitsFor } from '../../shared/utils/marathiDigits';

import type { CropProfile, FarmerProfile } from '../../types';
import { VerificationStatus } from '../../domain/types/farm.types';

/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I7 / WP-5) — one plain Marathi title per hub
 * page, the same words on the hub row and on the page's title bar (no English doubling).
 */
const HUB_TITLE: Record<'identity' | 'structure' | 'utils' | 'machines' | 'health', string> = {
    identity: 'माझी ओळख',
    structure: 'पिकं आणि प्लॉट',
    utils: 'पाणी आणि वीज',
    machines: 'यंत्रं',
    health: 'माती व पाणी अहवाल',
};

/** Repair FIX-1 item 3 — each hub STEP's title (water, motor and power are three steps of the one पाणी आणि वीज page). */
const STEP_LABEL: Record<HubStepId, string> = {
    identity: HUB_TITLE.identity,
    water: 'पाण्याचे स्रोत',
    motor: 'मोटर',
    power: 'वीज आणि वेळापत्रक',
    structure: HUB_TITLE.structure,
    team: TEAM_COPY.pageTitle,
    machines: HUB_TITLE.machines,
    health: HUB_TITLE.health,
};
const STEP_ICON: Record<HubStepId, React.ReactNode> = {
    identity: <User size={20} />,
    water: <Droplets size={20} />,
    motor: <Settings2 size={20} />,
    power: <Zap size={20} />,
    structure: <Sprout size={20} />,
    team: <Users size={20} />,
    machines: <Tractor size={20} />,
    health: <FlaskConical size={20} />,
};

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
    | 'people'
    /** spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — "माझी टीम", its own page (not a setup step). */
    | 'team';

/** Local Hub section type (was imported from the now-removed SetupHubAccordion). */
type HubSection = { id: ProfileTab; label: string; icon: React.ReactNode; body: React.ReactNode };

interface ProfilePageProps {
    profile: FarmerProfile;
    crops: CropProfile[];
    onUpdateProfile: (p: FarmerProfile) => void;
    onUpdateCrops: (c: CropProfile[]) => void;
    waterResources?: unknown;
    electricity?: unknown;
    onOpenScheduleLibrary?: (cropId?: string) => void;
    /** UI-9a (redesign item 7): Setup's "शेड्यूल बघा" - the शेड्यूल tab on this crop (home view). Absent: the library door is used. */
    onOpenSchedule?: (cropId?: string) => void;
    onOpenFinanceManager?: () => void;
    onOpenLabour?: () => void;
    /** The ONE "गोपनीयता व संमती" place: consents + a copy of my data + erase (plr-d10 I17). */
    onOpenConsent?: () => void;
    onOpenQrDemo?: () => void;
    /** spec: 2026-08-14-founder-decisions-launch-cohort-and-scope — offline
     * voice-note drafts waiting for the farmer's review. */
    onOpenAiDrafts?: () => void;
    /** Settings page: Voice Journal / Voice Diary + retention consent. */
    onOpenSettings?: () => void;
    /** spec: plr-d10 (H2) — आवाज नोंदी opens the recordings player directly (it used to go through Settings). */
    onOpenVoiceDiary?: () => void;
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
    onOpenScheduleLibrary, onOpenSchedule, onOpenFinanceManager, onOpenLabour,
    onOpenConsent, onOpenAiDrafts, onOpenSettings, onOpenVoiceDiary,
    onExit,
    initialTab,
}) => {
    const { logout, session: authSession } = useAuth();
    const { language, setLanguage } = useLanguage();
    // null = the Profile menu; a tab = that section's own page (with a back arrow).
    const [activeTab, setActiveTab] = useState<ProfileTab | null>(initialTab ?? null);
    // extra (settings) pages folded into Profile — e.g. 'language'.
    const [activeExtra, setActiveExtra] = useState<string | null>(null);
    // spec: plr-d10 (I17, H19) — one back model: the phone's own Back on a hub page returns to the hub,
    // exactly like the page's मागे (it used to leave the hub altogether).
    useBackDismiss(activeTab !== null || activeExtra !== null, () => { setActiveTab(null); setActiveExtra(null); });
    const waitingDrafts = useWaitingDraftCount();
    const { notes: waitingVoice } = useWaitingVoiceNotes();

    const cropPlot = useCropPlotState({ crops, onUpdateCrops });
    // CEI Phase 4 §4.8 — show own reliability score if user is a Worker or
    // Mukadam on any farm.
    const { currentFarmId: profileFarmId, currentFarm: appFarm, switchFarm, farms: meFarms, meContext } = useFarmContext();
    // Repair FIX-1 item 2 (R2-A 03 + 20): the hub follows the farm OPEN in the app — the one the header
    // and the switcher show — never "the first farm I own".
    const farmAdmin = useFarmAdminState(appFarm?.farmId ?? profileFarmId ?? null);

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

    // lane HONESTY-2 (H4) — the number this account signed in with, as the server holds it, for the one "सत्यापित" tick.
    const signedInPhone = meContext?.me
        ? { masked: meContext.me.phoneMasked, verified: meContext.me.phoneVerifiedAtUtc != null }
        : null;
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

    // Open a specific farm: switch app-wide farm context to it (the hub's farm follows it) and drill
    // into its own page (Identity).
    const handleOpenFarm = React.useCallback((farmId: string) => {
        switchFarm(farmId);
        setActiveTab('identity');
    }, [switchFarm]);

    // spec: owner-oversight-loop (Task 12) — the "तुमच्या शेती · Your farms"
    // row's own switch handler: switches farm context only, same as
    // AppHeader's own farm-switcher trigger (no drill-into-Identity, unlike
    // `handleOpenFarm` above, which is a DIFFERENT affordance — "open this
    // farm's page" — that already exists in `FarmsSection`). The hub's farm
    // is read from the farm context, so it follows this switch by itself.
    const handleSwitchFarmFromMenu = React.useCallback((farmId: string) => { switchFarm(farmId); }, [switchFarm]);

    // Guided-setup progress: a step counts as "done" once its core data is really saved.
    // Identity = name + village; water / motor / power = a source / a motor / power times the farmer
    // saved (repair FIX-1 item 3: three steps, one page); Crops = at least one crop.
    const doneIds = React.useMemo(() => {
        const s = new Set<HubStepId>();
        if (profile.name && profile.village) s.add('identity');
        if ((profile.waterResources?.length ?? 0) > 0) s.add('water');
        if ((profile.motors?.length ?? 0) > 0) s.add('motor');
        if (powerTimesSaved(profile.electricityTiming)) s.add('power');
        if (crops.length > 0) s.add('structure');
        if ((profile.machineries?.length ?? 0) > 0) s.add('machines');
        // 'health' (soil reports) cannot be done: report upload is not built (P5), so it is shown as
        // "लवकरच" and left out of the setup count rather than standing as a step nobody can finish.
        return s;
    }, [profile.name, profile.village, profile.waterResources, profile.motors, profile.electricityTiming, profile.machineries, crops.length]);

    const plotCount = crops.reduce((n, c) => n + c.plots.length, 0);
    // Repair FIX-1 item 5 - the plots still missing a link, by the same rule as the red marks on पिकं आणि प्लॉट.
    const scheduleChoices = usePlotScheduleChoices();
    const todayKey = getDateKey();
    const pendingPlotCount = React.useMemo(() => pendingPlots(crops, scheduleChoices, todayKey).length, [crops, scheduleChoices, todayKey]);

    // spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — the owner-only team roster, read ONCE here:
    // the hub's "माझी टीम" row shows how many people wait for an answer, the team page lists them.
    // Asked only when the SERVER says this person is owner tier on the farm (the route refuses
    // anyone else), so no one else's phone makes a refused call.
    const teamFarmId = farmAdmin.myFarm?.farmId ?? null;
    // lane 2b (founder D-26): the roster is people and permissions — the PRIMARY account holder's
    // alone; the server refuses a सहमालक now, so his phone never asks.
    const callerIsPrimary = isPrimaryAccountHolderRole(farmAdmin.myFarm?.role);
    const teamRoster = useLabourPermissions(callerIsPrimary ? teamFarmId : null);
    // lane 2b (D-15 via D-26) — adding a plot and drawing the boundary are "edit farm setup", read
    // from this seat's /me/context authorities on THIS farm. Farm not in /me/context → fail closed
    // (fix 1): only the primary account holder, who holds every authority, keeps the door.
    const setupFarm = meFarms.find(f => f.farmId === teamFarmId) ?? null;
    // Lane REM-1: the owner's reminder screen is drawn for the primary owner and a seat that holds its authority (the server decides every request).
    const mayManageReminders = callerIsPrimary || (setupFarm ? holdsAuthority(setupFarm, AUTHORITY.manageReminders) : false);
    const canEditFarmSetup = setupFarm
        ? holdsAuthority(setupFarm, AUTHORITY.editFarmSetup)
        : callerIsPrimary;
    // Repair FIX-1 item 10 (R2-B 15, founder 27 Nov) — the माझी टीम step: a MUST for the primary owner (red बाकी, counted by
    // "पुढचं", never a block), done once someone else is on the list, an invitation stands, or he says he runs this farm alone
    // for now — that mark is kept on this phone per farm (`teamSoloKey`; phone-only until the farm setup moves to the server).
    const [inviteKey, setInviteKey] = useState(0);
    const sentInvitations = useSentInvitations(callerIsPrimary ? teamFarmId : null, inviteKey);
    const [teamSolo, setTeamSolo, teamSoloLoaded] = useUiPref<boolean>(teamSoloKey(teamFarmId ?? '__no_farm__'), false);
    const teamStep = teamStepOf({
        isPrimaryOwner: callerIsPrimary && !!teamFarmId,
        callerUserId: authSession?.userId,
        rows: teamRoster.loadFailed ? null : teamRoster.rows,
        invitations: sentInvitations,
        solo: teamSoloLoaded ? teamSolo : null,
    });
    // The first team card's choice: the EXISTING invite sheet, that label chosen.
    const [inviteLabel, setInviteLabel] = useState<InvitationLabel | null>(null);
    const invitePlots = useFarmPlots(inviteLabel ? teamFarmId : null);
    // Founder D-22 (26 Oct): only the PRIMARY owner answers a request, so only his hub counts them.
    const teamRequestCount = farmAdmin.myFarm?.role === 'PrimaryOwner'
        ? splitRoster(teamRoster.rows).requests.length
        : 0;
    const teamFarmCode = farmAdmin.myMemberships.find(m => m.farmId === teamFarmId)?.farmCode ?? null;
    // The approved hub (PLR-D9 preview): the owner tier manages the team; a मुकादम looks at his crew;
    // a worker's hub has no team row.
    // A सहमालक / मुकादम opens the team page to LOOK (the view-only list); only the primary owner manages it.
    const canOpenTeam = isOwnerTierRole(farmAdmin.myFarm?.role) || farmAdmin.myFarm?.role === 'Mukadam';
    const openTeam = canOpenTeam ? () => setActiveTab('team') : undefined;

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-4 pb-[calc(8rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))]" style={{ fontFamily: SANS }}>
            {farmAdmin.myFarm && (
                <FarmInviteQrSheet
                    isOpen={farmAdmin.showInviteQr}
                    onClose={() => farmAdmin.setShowInviteQr(false)}
                    farmId={farmAdmin.myFarm.farmId}
                    farmName={farmAdmin.myFarm.name}
                />
            )}
            {/* Repair FIX-1 item 10 — the first team card's choice opens the EXISTING invite sheet with that label chosen. */}
            {inviteLabel && teamFarmId && (
                <InviteBuilderSheet farmId={teamFarmId} farmName={farmAdmin.myFarm?.name ?? ''} farmPlots={invitePlots} initialLabel={inviteLabel}
                    onMade={() => setInviteKey(k => k + 1)}
                    onClose={() => { setInviteLabel(null); setInviteKey(k => k + 1); }} />
            )}
            {farmAdmin.farmLookupError && farmAdmin.showInviteQr === false && (
                // lane FX-1 (FOOT-1) — above the bar's whole room (bottom-24 sat under its raised centre button).
                <div className="fixed left-1/2 -translate-x-1/2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 shadow-lg z-50"
                    style={{ bottom: BOTTOM_BAR_CLEARANCE }}>
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
                        headerCaption={`${activeCrop?.name || 'पीक'} · ${activePlot?.name || 'प्लॉट'}`}
                        headerTitle="प्लॉटची हद्द आखा"
                        onClose={() => cropPlot.setMappingPlotId(null)}
                        onPlotComplete={(geoData) => cropPlot.handleSaveMap(cropPlot.mappingPlotId!.cropId, cropPlot.mappingPlotId!.plotId, geoData)}
                        onDone={() => cropPlot.setMappingPlotId(null)}
                        existingGeoData={activePlot?.geoData}
                    />
                );
            })()}

            {farmAdmin.showFarmBoundary && farmAdmin.myFarm && (
                <BoundaryMapModal
                    headerCaption={`शेत · ${farmAdmin.myFarm.name}`}
                    headerTitle="शेताची हद्द आखा"
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
                        label: HUB_TITLE.identity,
                        icon: <User size={20} />,
                        body: (
                            <IdentitySection
                                profile={profile}
                                onUpdateProfile={onUpdateProfile}
                                logout={logout}
                                myFarm={farmAdmin.myFarm}
                                myMemberships={farmAdmin.myMemberships}
                                pendingSeats={farmAdmin.pendingSeats}
                                currentFarmId={profileFarmId}
                                farmDetails={farmAdmin.farmDetails}
                                weatherConnected={farmAdmin.weatherConnected}
                                connectingWeather={farmAdmin.connectingWeather}
                                connectError={farmAdmin.connectError}
                                handleConnectWeather={farmAdmin.handleConnectWeather}
                                setShowFarmBoundary={farmAdmin.setShowFarmBoundary}
                                canEditFarmSetup={canEditFarmSetup}
                                onOpenTeam={openTeam}
                                nonExitableFarmIds={nonExitableFarmIds}
                                handleExitMembership={farmAdmin.handleExitMembership}
                                isWorkerOnAnyFarm={isWorkerOnAnyFarm}
                                workerProfile={workerProfile}
                                signedInPhone={signedInPhone}
                            />
                        ),
                    },
                    {
                        id: 'structure',
                        label: HUB_TITLE.structure,
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
                                canAddPlot={canEditFarmSetup}
                                onOpenScheduleLibrary={onOpenScheduleLibrary}
                                onOpenSchedule={onOpenSchedule}
                            />
                        ),
                    },
                    { id: 'utils', label: HUB_TITLE.utils, icon: <Zap size={20} />, body: <UtilitiesSection profile={profile} onUpdate={onUpdateProfile} /> },
                    { id: 'machines', label: HUB_TITLE.machines, icon: <Tractor size={20} />, body: <MachinesSection profile={profile} onUpdate={onUpdateProfile} /> },
                    { id: 'health', label: HUB_TITLE.health, icon: <FlaskConical size={20} />, body: <HealthSection /> },
                ];

                // One plain line per row, from the farmer's REAL data (no sample values).
                const waterCount = profile.waterResources?.length ?? 0;
                const motorCount = profile.motors?.length ?? 0;
                const machineCount = profile.machineries?.length ?? 0;
                const subtitleFor = (id: HubStepId): string => {
                    if (id === 'identity') return doneIds.has('identity') ? 'नाव आणि गाव भरलं' : 'नाव आणि गाव भरा';
                    if (id === 'water') return waterCount > 0 ? `${waterCount} स्रोत` : 'विहीर, बोअर, कालवा, शेततळं';
                    if (id === 'motor') return motorCount > 0 ? `${motorCount} मोटर` : 'स्रोतावरची मोटर';
                    if (id === 'power') return doneIds.has('power') ? 'विजेच्या वेळा जतन झाल्या' : 'सिंगल फेज आणि थ्री फेज';
                    if (id === 'structure') {
                        if (crops.length === 0) return 'पिकं आणि प्लॉट जोडा';
                        // Marathi digits, like every other "पिकं · प्लॉट" line in the app; the pending count (FIX-1 item 5) only when there is one.
                        const line = `${digitsFor(crops.length, 'mr')} पिकं · ${digitsFor(plotCount, 'mr')} प्लॉट`;
                        return pendingPlotCount > 0 ? `${line} · ${PLOT_PENDING_WORDS.mr.hubCount(pendingPlotCount)}` : line;
                    }
                    if (id === 'machines') return machineCount > 0 ? `${machineCount} यंत्रं` : 'ट्रॅक्टर, फवारणी यंत्र';
                    if (id === 'health') return 'अहवाल जोडण्याची सोय अजून नाही';
                    return '';
                };
                // The three water / motor / power steps open one page, so they share its one guide.
                const UTILS_HELP = { what: 'तुमच्या शेतातील पाण्याचे स्रोत आणि वीज जोडणी.', do: 'विहीर किंवा बोअर, मोटर किती HP, आणि वीज जोडणी भरा.', why: 'पाणी व वीज खर्चाचं नियोजन नीट करता येतं.' };
                const SETUP_HELP: Partial<Record<HubStepId, { what: string; do: string; why: string }>> = {
                    identity: { what: 'तुमची ओळख — तुम्ही कोण आणि कुठले शेतकरी.', do: 'तुमचं पूर्ण नाव आणि गाव भरा.', why: 'पडताळलेली ओळख असली की तुमच्या नोंदींवर विश्वास वाढतो.' },
                    water: UTILS_HELP,
                    motor: UTILS_HELP,
                    power: UTILS_HELP,
                    structure: { what: 'तुम्ही काय पिकवता आणि कुठे — पिके व जमिनीचे तुकडे (प्लॉट).', do: 'पीक निवडा, किती प्लॉट सांगा, प्रत्येकाची सीमा नकाशावर काढा.', why: 'प्रत्येक प्लॉटची रोजची नोंद, हवामान व खर्च वेगळे कळतात.' },
                    machines: { what: 'तुमची स्वतःची किंवा भाड्याची शेती-यंत्रे.', do: 'प्रत्येक यंत्र जोडा — ट्रॅक्टर, पंप, फवारणी यंत्र वगैरे.', why: 'यंत्रांचा वापर आणि खर्च नोंदवता येतो.' },
                    // P5: no promise of an upload that does not exist.
                    health: { what: 'तुमच्या मातीची आणि पाण्याची तपासणी.', do: 'अहवाल जोडण्याची सोय अजून तयार नाही — लवकरच.', why: 'तयार झाल्यावर तुमच्या मातीप्रमाणे खताचा विचार करता येईल.' },
                };
                // Repair FIX-1 item 3: the founder's order (hubSteps.ts). माझी टीम sits in it for whoever has the team door.
                const steps = HUB_STEP_ORDER.filter(id => id !== 'team' || openTeam);
                // FIX-1 item 10: the team step is a counted step only for the primary owner, once its facts are known.
                const isDone = (id: HubStepId): boolean => (id === 'team' ? teamStep.counted && teamStep.done : doneIds.has(id));
                const menuItems: HubMenuItem[] = steps.map(id => ({
                    id, tab: HUB_STEP_TAB[id], label: STEP_LABEL[id], icon: STEP_ICON[id], subtitle: subtitleFor(id),
                    done: id === 'team' && !teamStep.counted ? undefined : isDone(id), soon: id === 'health', help: SETUP_HELP[id],
                    ...(id === 'team' && teamStep.counted && { mustDo: true, firstCard: teamStep.firstCard }),
                }));

                // Farm-setup progress — one honest count over the setup steps that CAN be done
                // ('health' cannot: report upload is not built; the team step only where it is counted).
                const setupOrder = steps.filter(id => id !== 'health' && (id !== 'team' || teamStep.counted));
                const doneCount = setupOrder.filter(isDone).length;
                const nextId = setupOrder.find(id => !isDone(id));
                const setupProgress = {
                    done: doneCount,
                    total: setupOrder.length,
                    percent: Math.round((doneCount / setupOrder.length) * 100),
                    nextId,
                    nextLabel: nextId ? STEP_LABEL[nextId] : undefined,
                };

                const langLabel = language === 'mr' ? 'मराठी' : 'English';
                // Billing farm = the app's current farm (or first membership) — MyFarmDto carries the subscription.
                const billingFarm = farmAdmin.myMemberships.find(m => m.farmId === profileFarmId) ?? farmAdmin.myMemberships[0];
                const isOwner = billingFarm?.role === 'PrimaryOwner';
                // Plain Marathi only (founder T1–T3: no English doubling). Every new string is PROPOSED.
                const settingsMeta: Record<string, { label: string; icon: React.ReactNode; subtitle?: string; badge?: React.ReactNode }> = {
                    language: { label: 'भाषा', icon: <Globe size={22} />, subtitle: langLabel },
                    // Lane OF (founder D-59) — recordings not saved yet live here: the row says how many (THE one reader,
                    // the same number as on the gear and the page).
                    'voice-diary': {
                        label: 'आवाज नोंदी', icon: <BookOpen size={22} />,
                        subtitle: voiceNotesWords(language).rowLine(waitingCounts(waitingVoice), 'तुम्ही बोललेल्या नोंदी — दिवसानुसार ऐका'),
                        ...(waitingVoice.length > 0 && { badge: <span data-testid="voice-notes-row-count"><Chip tone="amber">{waitingVoice.length}</Chip></span> }),
                    },
                    // PROPOSED (Marathi): "परवानग्या · माझा डेटा" (the preview's line; copy + erase now live inside).
                    consent: { label: PRIVACY_TITLE, icon: <Shield size={22} />, subtitle: 'परवानग्या · माझा डेटा' },
                    billing: { label: 'बिलिंग', icon: <CreditCard size={22} />, subtitle: 'तुमचा प्लॅन' },
                    // PROPOSED (Marathi): one name with its page (OFFLINE_NOTES_TITLE). Lane OF (D-59): voice recordings moved
                    // to आवाज नोंदी; this row now counts only bill / sale-slip photos made without internet.
                    'ai-drafts': {
                        label: OFFLINE_NOTES_TITLE, icon: <Mic size={22} />, subtitle: 'बिलाचे / पट्टीचे फोटो', // PROPOSED (Marathi) — lane OF
                        badge: <Chip tone="amber">{waitingDrafts}</Chip>,
                    },
                };
                const settingsItems = buildSettingsExtraIds(isOwner, waitingDrafts > 0).map(id => ({ id, ...settingsMeta[id] }));

                const handleSelectExtra = (id: string) => {
                    if (id === 'consent') { onOpenConsent?.(); return; }
                    if (id === 'ai-drafts') { onOpenAiDrafts?.(); return; }
                    if (id === 'voice-diary') { (onOpenVoiceDiary ?? onOpenSettings)?.(); return; }
                    setActiveExtra(id); // 'language' | 'billing' — folded sub-screens
                };

                if (activeExtra === 'language') {
                    const langs: { code: 'mr' | 'en'; native: string }[] = [
                        { code: 'mr', native: 'मराठी' },
                        { code: 'en', native: 'English' },
                    ];
                    return (
                        <div>
                            <PageBar title="भाषा" onBack={() => setActiveExtra(null)} />
                            <div className="space-y-2.5">
                                {langs.map(l => (
                                    <Tap key={l.code} onClick={() => setLanguage(l.code)} aria-pressed={language === l.code} data-testid={`lang-${l.code}`}
                                        className={`flex min-h-[60px] w-full items-center justify-between rounded-2xl px-4 text-[18px] font-extrabold ${language === l.code ? 'bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500' : 'bg-white text-stone-800 ring-1 ring-stone-200'}`}>
                                        {l.native}{language === l.code && <Check size={22} aria-hidden="true" />}
                                    </Tap>
                                ))}
                            </div>
                        </div>
                    );
                }
                if (activeExtra === 'billing') {
                    return (
                        <div>
                            <PageBar title="बिलिंग" onBack={() => setActiveExtra(null)} />
                            {/* lane HONESTY-2 (H5): no `onManageBilling` — there is no billing portal yet, and the English
                                "coming soon" alert it used to fire sat behind every button on the card (P5). */}
                            <SubscriptionCard
                                subscription={billingFarm?.subscription}
                                role={billingFarm?.role ?? ''}
                            />
                        </div>
                    );
                }

                // Lane REM-1 (founder D-78, R17): "आठवणी कोणाला दिसतील", beside the team page - for the primary owner and a seat that
                // holds "आठवणींची मांडणी बदलणे" only; online only (it says so when there is no net: R21).
                if (activeExtra === 'reminders' && mayManageReminders) {
                    return (
                        <div data-testid="hub-page-reminders">
                            <PageBar title={plannedWorkWords(language).reminders.settingsTitle} onBack={() => setActiveExtra(null)} />
                            <ReminderSettingsPage farmId={teamFarmId} callerUserId={authSession?.userId ?? null} isPrimaryOwner={callerIsPrimary} roster={callerIsPrimary ? teamRoster : null} />
                        </div>
                    );
                }

                if (activeTab === 'team') {
                    return (
                        <div data-testid="hub-page-team">
                            <PageBar title={TEAM_COPY.pageTitle} onBack={() => setActiveTab(null)} />
                            {mayManageReminders && (
                                <Tap onClick={() => setActiveExtra('reminders')} data-testid="team-open-reminder-settings"
                                    className="mb-3 flex min-h-[52px] w-full items-center justify-center rounded-full border-2 border-emerald-600 bg-white text-[15px] font-extrabold text-emerald-800">
                                    {plannedWorkWords(language).reminders.settingsEntry}
                                </Tap>
                            )}
                            <TeamPage
                                farmId={teamFarmId}
                                farmCode={teamFarmCode}
                                callerRole={farmAdmin.myFarm?.role ?? null}
                                callerUserId={authSession?.userId ?? null}
                                operators={profile.operators}
                                roster={teamRoster}
                                onShowQr={() => { void farmAdmin.handleOpenInviteQr(); }}
                            />
                        </div>
                    );
                }

                const current = activeTab ? sections.find(s => s.id === activeTab) : undefined;
                if (!current) {
                    return (
                        <SetupHubMenu
                            farmerName={profile.name ?? ''}
                            /* One truth about verification (PLR-D9 T4): a filled name + village is NOT a verified
                               identity — only a government-verified one is called that. */
                            verified={profile.verificationStatus === VerificationStatus.GovernmentVerified}
                            farmName={farmAdmin.myFarm?.name ?? undefined}
                            farms={farmAdmin.myMemberships}
                            familyName={profile.name ? `${profile.name.split(' ')[0]} कुटुंब` : undefined}
                            onOpenFarm={handleOpenFarm}
                            currentFarmId={profileFarmId ?? undefined}
                            onSwitchFarm={handleSwitchFarmFromMenu}
                            onCreateFarm={requestCreateFarmWizard}
                            onJoinViaQr={requestJoinFarm}
                            language={language}
                            setupProgress={setupProgress}
                            items={menuItems}
                            onSelect={setActiveTab}
                            onExit={onExit}
                            // spec: plr-d10 lane MU-1 - "पैसे व हिशोब" is drawn only for a seat that sees the farm's money.
                            onOpenFinance={seatDoors(setupFarm).money ? onOpenFinanceManager : undefined}
                            onOpenLabour={onOpenLabour}
                            farmCode={teamFarmCode}
                            onOpenTeam={openTeam}
                            teamViewOnly={!callerIsPrimary}
                            teamRequestCount={teamRequestCount}
                            onInviteLabel={callerIsPrimary && teamFarmId ? setInviteLabel : undefined}
                            onTeamSolo={() => setTeamSolo(true)}
                            settingsItems={settingsItems}
                            onSelectExtra={handleSelectExtra}
                            logout={logout}
                        />
                    );
                }
                return (
                    <div data-testid={`hub-page-${current.id}`}>
                        <PageBar title={current.label} onBack={() => setActiveTab(null)} />
                        {current.body}
                    </div>
                );
            })()}
        </div>
    );
};

export default ProfilePage;
