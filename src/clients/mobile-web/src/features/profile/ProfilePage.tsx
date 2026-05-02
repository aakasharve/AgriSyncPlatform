/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 6 — ProfilePage orchestrator.
 *
 * Owns the tab state, lift-up handlers, and modal overlays. Each tab body
 * lives in its own `./sections/<X>Section.tsx`. Section state remains owned
 * here and is passed in as props so the 9569047 smoke snapshot test stays
 * byte-equivalent across the move.
 *
 * Ramp-up notes:
 *   - The 'plan' and 'people' tabs are not currently rendered (the matching
 *     entries in the original god-file were commented out / merged into
 *     IdentitySection). Their leaf section files live under ./sections/
 *     anyway so re-enabling them is a one-line wiring change.
 *   - Backwards-compat: `pages/ProfilePage.tsx` is now a 2-line shim
 *     re-exporting this module so AppRouter's lazy import + the upstream
 *     snapshot test continue to work without modification.
 *   - Storage: this file holds the WEATHER_CONNECTED (per-farm) +
 *     `shramsafal_setup_sidebar_collapsed` flags. Both now persist through
 *     the useUiPref hook (Dexie's uiPrefs table) — the original
 *     localStorage paths have been retired in
 *     T-IGH-04-LOCALSTORAGE-MIGRATION wave-4-A.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
    FlaskConical,
    User, Zap, MapPin, Plus, X, Sprout,
    ArrowRight, Tractor, BarChart3, CalendarDays,
    ChevronRight, BrainCircuit,
    Medal, Users, AlertTriangle,
    PanelLeftClose, PanelLeftOpen
} from 'lucide-react';
import {
    FarmerProfile, WaterResource, FarmMotor,
    CropProfile, Plot, FarmMachinery,
    PlotInfrastructure, PlantingMaterial,
    OperatorCapability, VerificationStatus, CropScheduleTemplate
} from '../../types';
import { CropSymbol } from '../context/components/CropSelector';
// import Link from 'next/link'; // REMOVED
import { Person, PlotGeoData } from '../../types';
import { AddMemberWizard } from '../people/components/AddMemberWizard';
import FarmInviteQrSheet from '../onboarding/qr/FarmInviteQrSheet';
import type { SubscriptionSnapshotView } from '../admin/billing/EntitlementBanner';
import type { MyFarmDto, FarmDetailsDto } from '../onboarding/qr/inviteApi';
import { getFarmDetails, updateFarmBoundary, probeFarmWeather } from '../onboarding/qr/inviteApi';

// Per-farm UX consent flag remembering that the owner explicitly opted in to
// live weather. The backend always serves weather once the canonical centre
// is set; this flag just collapses the "Connect Farm to Weather" tile after
// the user has acknowledged the link. Persists through useUiPref (Dexie).
const weatherConnectedKey = (farmId: string) => `farm:weatherConnected:${farmId}`;
import { PlotMap } from '../context/components/PlotMap';
import { getDateKey } from '../../core/domain/services/DateKeyService';
import { getTemplateById as getScheduleById, getTemplatesForCrop as getSchedulesForCrop } from '../../infrastructure/reference/TemplateCatalog';
import { useLanguage } from '../../i18n/LanguageContext';
import { useAuth } from '../../app/providers/AuthProvider';
import { idGenerator } from '../../core/domain/services/IdGenerator';
import { systemClock } from '../../core/domain/services/Clock';
import { useWorkerProfile } from '../work/hooks/useWorkerProfile';
import { useFarmContext } from '../../core/session/FarmContext';
import { useUiPref } from '../../shared/hooks/useUiPref';

import IdentitySection from './sections/IdentitySection';
import StructureSection from './sections/StructureSection';
import UtilitiesSection from './sections/UtilitiesSection';
import MachinesSection from './sections/MachinesSection';
import HealthSection from './sections/HealthSection';
import IntelligenceSection from './sections/IntelligenceSection';
import AddPlotWizard from './components/AddPlotWizard';

/**
 * The eight tabs rendered by ProfilePage. Exported so tests (and any future
 * deep-link helper) can address tabs without re-declaring the literal union.
 *
 * Sub-plan 04 Task 1 introduces the `initialTab` test seam on ProfilePageProps;
 * Task 6 removes the prop once tabs become route segments under `features/profile/`.
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
    waterResources?: any;
    electricity?: any;
    // People Handlers
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

// --- CONSTANTS ---
const CROP_ICONS = ['Grape', 'Sugarcane', 'Cotton', 'Wheat', 'Onion', 'Sprout', 'Pomegranate', 'Trees'];

// 20+ unique Tailwind colors for crops - guaranteed no repetition for typical farm sizes
const CROP_COLORS = [
    'bg-emerald-500',   // 1
    'bg-blue-500',      // 2
    'bg-purple-500',    // 3
    'bg-orange-500',    // 4
    'bg-pink-500',      // 5
    'bg-teal-500',      // 6
    'bg-rose-500',      // 7
    'bg-amber-500',     // 8
    'bg-indigo-500',    // 9
    'bg-cyan-500',      // 10
    'bg-lime-500',      // 11
    'bg-fuchsia-500',   // 12
    'bg-sky-500',       // 13
    'bg-violet-500',    // 14
    'bg-red-500',       // 15
    'bg-green-600',     // 16
    'bg-blue-600',      // 17
    'bg-yellow-600',    // 18
    'bg-purple-600',    // 19
    'bg-orange-600',    // 20
];

// Helper: Get the next unused color based on existing crops
const getNextUnusedColor = (existingCrops: CropProfile[]): string => {
    const usedColors = new Set(existingCrops.map(c => c.color));
    // Find first unused color from palette
    for (const color of CROP_COLORS) {
        if (!usedColors.has(color)) {
            return color;
        }
    }
    // Fallback if all colors used: generate a unique shade based on index
    const index = existingCrops.length;
    const shades = ['400', '500', '600', '700'];
    const baseColors = ['emerald', 'blue', 'purple', 'orange', 'pink', 'teal', 'rose', 'amber', 'indigo', 'cyan'];
    const baseColor = baseColors[index % baseColors.length];
    const shade = shades[Math.floor(index / baseColors.length) % shades.length];
    return `bg-${baseColor}-${shade}`;
};

// --- MAIN PAGE LAYOUT ---

const ProfilePage: React.FC<ProfilePageProps> = ({ profile, crops, onUpdateProfile, onUpdateCrops, onAddPerson, onDeletePerson, onOpenScheduleLibrary, onOpenFinanceManager, onOpenReferrals, onOpenQrDemo, initialTab }) => {
    const { t } = useLanguage();
    const { logout, session: authSession } = useAuth();
    const [activeTab, setActiveTab] = useState<ProfileTab>(initialTab ?? 'structure');

    // Crop & Plot State (Reused from previous, simplified)
    const [isAddingCrop, setIsAddingCrop] = useState(false);
    const [newCropData, setNewCropData] = useState<Partial<CropProfile>>({ iconName: 'Sprout' });
    const [cropNameError, setCropNameError] = useState<string>('');

    // New Plot Wizard State
    const [wizardCropId, setWizardCropId] = useState<string | null>(null);
    const [mappingPlotId, setMappingPlotId] = useState<{ cropId: string, plotId: string } | null>(null);
    const normalizeCropName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
    const normalizedNewCropName = normalizeCropName(newCropData.name || '');
    const isDuplicateCropName = normalizedNewCropName.length > 0 &&
        crops.some(c => normalizeCropName(c.name) === normalizedNewCropName);

    // Handlers (Simplified for brevity, logic identical to previous)
    const handleAddCrop = () => {
        // Validate crop name
        const trimmedName = newCropData.name?.trim() || '';
        if (trimmedName.length < 2) {
            setCropNameError('Crop name is required (at least 2 characters)');
            return;
        }
        if (crops.some(c => normalizeCropName(c.name) === normalizeCropName(trimmedName))) {
            setCropNameError('This crop already exists. One crop can be added only once.');
            return;
        }
        setCropNameError('');

        const autoColor = getNextUnusedColor(crops);
        const defaultScheduleId = getSchedulesForCrop(trimmedName)[0]?.id || null;
        const newCrop: CropProfile = {
            id: `c_${idGenerator.generate()}`,
            name: trimmedName,
            iconName: newCropData.iconName!,
            color: autoColor,
            plots: [],
            activeScheduleId: defaultScheduleId,
            supportedTasks: ['General'],
            workflow: [],
            createdAt: systemClock.nowISO()
        };
        onUpdateCrops([...crops, newCrop]);
        setIsAddingCrop(false);
        setNewCropData({ iconName: 'Sprout' });
    };

    const handleAddPlot = (plot: Plot) => {
        onUpdateCrops(crops.map(crop => {
            if (crop.id !== wizardCropId) return crop;

            const adoptedScheduleId = plot.schedule?.templateId || crop.activeScheduleId || null;
            const adoptedTemplate = getScheduleById(adoptedScheduleId || '');

            return {
                ...crop,
                activeScheduleId: adoptedScheduleId,
                plots: [...crop.plots, plot].map(existingPlot => {
                    if (!adoptedScheduleId || !adoptedTemplate) return existingPlot;
                    return {
                        ...existingPlot,
                        schedule: {
                            ...existingPlot.schedule,
                            templateId: adoptedScheduleId,
                            referenceType: adoptedTemplate.referenceType,
                            stageOverrides: [],
                            expectationOverrides: []
                        }
                    };
                })
            };
        }));
        setWizardCropId(null);
    };

    const handleSaveMap = (cropId: string, plotId: string, geoData: PlotGeoData) => {
        onUpdateCrops(crops.map(c => {
            if (c.id !== cropId) return c;
            return {
                ...c,
                plots: c.plots.map(p => {
                    if (p.id !== plotId) return p;
                    return {
                        ...p,
                        geoData,
                        baseline: {
                            ...p.baseline,
                            totalArea: parseFloat(geoData.calculatedAreaAcres.toFixed(2)), // Auto-update area
                            unit: 'Acre'
                        }
                    };
                })
            };
        }));
    };

    const deleteCrop = (id: string) => onUpdateCrops(crops.filter(c => c.id !== id));
    const deletePlot = (cId: string, pId: string) => onUpdateCrops(crops.map(c => c.id === cId ? { ...c, plots: c.plots.filter(p => p.id !== pId) } : c));

    // Sidebar collapse (web only). Persists across reloads so returning users
    // keep their preferred layout. On mobile (<lg) the sidebar stacks above
    // content and this flag is ignored so the Android/small-screen flow is
    // unchanged. Sub-plan 04 Task 3 — useUiPref returns the `false` fallback
    // on the first render and swaps in the persisted value once Dexie load
    // resolves; on desktop this is a one-frame layout flicker compared to
    // the previous synchronous read.
    const [sidebarCollapsed, setSidebarCollapsed] = useUiPref<boolean>('shramsafal_setup_sidebar_collapsed', false);

    const TabItem = ({ id, label, icon }: { id: typeof activeTab, label: string, icon: React.ReactNode }) => {
        const isActive = activeTab === id;
        return (
            <button
                onClick={() => setActiveTab(id)}
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

    const [showMemberWizard, setShowMemberWizard] = useState(false);
    const [showInviteQr, setShowInviteQr] = useState(false);
    const [myFarm, setMyFarm] = useState<{ farmId: string; name: string; role: string; subscription: SubscriptionSnapshotView | null } | null>(null);
    const [myMemberships, setMyMemberships] = useState<MyFarmDto[]>([]);
    const [farmLookupError, setFarmLookupError] = useState<string | null>(null);
    const [farmDetails, setFarmDetails] = useState<FarmDetailsDto | null>(null);
    const [showFarmBoundary, setShowFarmBoundary] = useState(false);
    const [savingBoundary, setSavingBoundary] = useState(false);
    const [boundaryError, setBoundaryError] = useState<string | null>(null);
    // Sub-plan 04 Task 3 — per-farm weather-connected flag now persists
    // through useUiPref. The hook key changes whenever myFarm.farmId
    // changes, so Dexie automatically re-loads the right farm's value;
    // when no farm is loaded we point at a sentinel key whose value is
    // never written, keeping the hook unconditional. The previous
    // useEffect that copied localStorage → state on farmId change is
    // therefore redundant and has been removed.
    const weatherPrefKey = weatherConnectedKey(myFarm?.farmId ?? '__no_farm__');
    const [weatherConnectedRaw, setWeatherConnectedPref] = useUiPref<boolean>(weatherPrefKey, false);
    // Mask the sentinel-keyed value so the UI shows false when no farm is loaded.
    const weatherConnected = myFarm?.farmId ? weatherConnectedRaw : false;
    const [connectingWeather, setConnectingWeather] = useState(false);
    const [connectError, setConnectError] = useState<string | null>(null);

    // --- HANDLERS ---
    const handleAddMember = (member: any) => {
        if (onAddPerson) onAddPerson({ ...member, id: `p_${idGenerator.generate()}` });
        setShowMemberWizard(false);
    };

    // When the owner taps "Share farm QR" we need the real server farmId,
    // not the localStorage phone string. /shramsafal/farms/mine returns
    // that. Lazy-load on first open.
    const handleOpenInviteQr = React.useCallback(async () => {
        setFarmLookupError(null);
        if (myFarm) {
            setShowInviteQr(true);
            return;
        }
        try {
            const { getMyFarms } = await import('../onboarding/qr/inviteApi');
            const farms = await getMyFarms();
            if (farms.length === 0) {
                setFarmLookupError('You do not own a farm yet. Ask for help to set one up.');
                return;
            }
            const ownerFarm = farms.find(f => f.role === 'PrimaryOwner' || f.role === 'SecondaryOwner') ?? farms[0];
            setMyFarm({
                farmId: ownerFarm.farmId,
                name: ownerFarm.name,
                role: ownerFarm.role,
                subscription: ownerFarm.subscription ?? null,
            });
            setShowInviteQr(true);
        } catch (err) {
            setFarmLookupError(err instanceof Error ? err.message : 'Could not load your farm.');
        }
    }, [myFarm]);

    // Load the farm snapshot on mount so the entitlement banner shows
    // without waiting for the owner to tap "Share farm QR" first.
    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const { getMyFarms } = await import('../onboarding/qr/inviteApi');
                const farms = await getMyFarms();
                if (cancelled) return;
                setMyMemberships(farms);
                if (farms.length === 0) return;
                const ownerFarm = farms.find(f => f.role === 'PrimaryOwner' || f.role === 'SecondaryOwner') ?? farms[0];
                setMyFarm(prev => prev ?? {
                    farmId: ownerFarm.farmId,
                    name: ownerFarm.name,
                    role: ownerFarm.role,
                    subscription: ownerFarm.subscription ?? null,
                });
            } catch {
                /* silent — user may not be authenticated yet */
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // Pull the farm's canonical centre + mapped-area so the Identity card
    // can show whether the farm boundary has been drawn. Weather needs this
    // too — without a canonical centre the forecast endpoint returns 400.
    React.useEffect(() => {
        if (!myFarm?.farmId) { setFarmDetails(null); return; }
        let cancelled = false;
        (async () => {
            try {
                const dto = await getFarmDetails(myFarm.farmId);
                if (!cancelled) setFarmDetails(dto);
            } catch {
                if (!cancelled) setFarmDetails(null);
            }
        })();
        return () => { cancelled = true; };
    }, [myFarm?.farmId]);

    const handleSaveFarmBoundary = React.useCallback(async (geoData: PlotGeoData) => {
        if (!myFarm?.farmId || savingBoundary) return;
        setSavingBoundary(true);
        setBoundaryError(null);
        try {
            const updated = await updateFarmBoundary(myFarm.farmId, {
                boundary: geoData.boundary.map(p => ({ lat: p.lat, lng: p.lng })),
                centre: { lat: geoData.center.lat, lng: geoData.center.lng },
                areaAcres: Number(geoData.calculatedAreaAcres.toFixed(4)),
            });
            setFarmDetails(updated);
        } catch (err) {
            const message = err instanceof Error ? err.message
                : (typeof err === 'object' && err && 'message' in err) ? String((err as { message: unknown }).message)
                : 'Could not save farm boundary.';
            setBoundaryError(message);
        } finally {
            setSavingBoundary(false);
        }
    }, [myFarm?.farmId, savingBoundary]);

    const handleFinishFarmBoundary = React.useCallback(() => {
        setShowFarmBoundary(false);
        setBoundaryError(null);
        // No reload here — we now want the user to see the intermediate
        // "Connect Farm to Weather" tile so they own the moment of consent.
        // The Connect handler reloads after the probe succeeds.
    }, []);

    const handleConnectWeather = React.useCallback(async () => {
        if (!myFarm?.farmId || connectingWeather) return;
        setConnectingWeather(true);
        setConnectError(null);
        try {
            await probeFarmWeather(myFarm.farmId);
            // useUiPref persists this through Dexie's uiPrefs keyed by
            // weatherConnectedKey(myFarm.farmId).
            setWeatherConnectedPref(true);
            // Reload so useWeatherMonitor re-inits and the WeatherWidget
            // leaves its skeleton state on the daily-log page.
            window.setTimeout(() => window.location.reload(), 200);
        } catch (err) {
            const apiErr = err as { error?: string; message?: string };
            if (apiErr?.error === 'ShramSafal.WeatherProviderNotConfigured') {
                setConnectError(
                    'Weather provider not yet available — your boundary is saved. We\'ll auto-enable live weather as soon as the provider key is configured.',
                );
            } else if (apiErr?.error === 'ShramSafal.FarmCentreMissing') {
                setConnectError('Farm boundary missing. Please draw the boundary first.');
            } else {
                setConnectError(apiErr?.message ?? 'Could not connect weather. Please try again.');
            }
        } finally {
            setConnectingWeather(false);
        }
    }, [myFarm?.farmId, connectingWeather]);

    const handleExitMembership = React.useCallback(async (farmId: string, _farmName: string) => {
        const { exitMembership, getMyFarms, isInviteApiError } = await import('../onboarding/qr/inviteApi');
        try {
            await exitMembership(farmId);
            const refreshed = await getMyFarms();
            setMyMemberships(refreshed);
            if (myFarm?.farmId === farmId) {
                setMyFarm(null);
            }
        } catch (err) {
            const message = isInviteApiError(err) ? err.message : 'Exit failed.';
            throw new Error(message);
        }
    }, [myFarm?.farmId]);

    // Compute which memberships the caller can't exit — any PrimaryOwner
    // farm where they're the sole PrimaryOwner. Client-side heuristic; the
    // server is still the source of truth and will return 409 if we guess wrong.
    // CEI Phase 4 §4.8 — show own reliability score if user is a Worker or Mukadam on any farm
    const { currentFarmId: _profileFarmId } = useFarmContext();
    const isWorkerOnAnyFarm = myMemberships.some(m => m.role === 'Worker' || m.role === 'Mukadam');
    const { profile: workerProfile } = useWorkerProfile(
        isWorkerOnAnyFarm ? (authSession?.userId ?? null) : null,
        _profileFarmId,
    );
    const nonExitableFarmIds = React.useMemo(() => {
        const ids = new Set<string>();
        for (const m of myMemberships) {
            if (m.role === 'PrimaryOwner') {
                ids.add(m.farmId); // conservative: assume they are the last
            }
        }
        return ids;
    }, [myMemberships]);

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-4 pb-32">

            {/* MEMBER WIZARD */}
            {showMemberWizard && (
                <AddMemberWizard
                    onSave={handleAddMember}
                    onCancel={() => setShowMemberWizard(false)}
                />
            )}

            {/* FARM INVITE QR SHEET */}
            {myFarm && (
                <FarmInviteQrSheet
                    isOpen={showInviteQr}
                    onClose={() => setShowInviteQr(false)}
                    farmId={myFarm.farmId}
                    farmName={myFarm.name}
                />
            )}
            {farmLookupError && showInviteQr === false && (
                <div className="fixed bottom-24 left-1/2 -translate-x-1/2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 shadow-lg z-50">
                    {farmLookupError}
                </div>
            )}

            {/* Wizard Overlay */}
            {wizardCropId && (
                <AddPlotWizard
                    crop={crops.find(c => c.id === wizardCropId)!}
                    profile={profile}
                    onSave={handleAddPlot}
                    onCancel={() => setWizardCropId(null)}
                />
            )}

            {/* Map Overlay — full-bleed bottom sheet on mobile, centered dialog on lg+.
                z-[60] sits above BottomNavigation (z-50) so the nav is fully covered. */}
            {mappingPlotId && (() => {
                const activeCrop = crops.find(c => c.id === mappingPlotId.cropId);
                const activePlot = activeCrop?.plots.find(p => p.id === mappingPlotId.plotId);
                return (
                    <div className="fixed inset-0 z-[60] bg-slate-900/50 backdrop-blur-sm animate-in fade-in lg:flex lg:items-center lg:justify-center lg:p-6">
                        <div className="bg-white h-full w-full flex flex-col overflow-hidden lg:h-auto lg:max-h-[92vh] lg:max-w-3xl lg:rounded-3xl lg:shadow-2xl">
                            {/* Compact sticky header */}
                            <div className="flex-shrink-0 bg-white/95 backdrop-blur-md border-b border-slate-100 px-4 py-3 flex items-center justify-between">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="bg-emerald-100 text-emerald-600 p-1.5 rounded-lg flex-shrink-0">
                                        <MapPin size={16} />
                                    </div>
                                    <div className="leading-tight min-w-0">
                                        <p className="text-[11px] text-slate-500 truncate">
                                            {activeCrop?.name || 'Crop'} · <span className="font-semibold text-slate-700">{activePlot?.name || 'Plot'}</span>
                                        </p>
                                        <p className="text-sm font-bold text-slate-900">Draw plot boundary</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setMappingPlotId(null)}
                                    className="p-2 rounded-full text-slate-400 hover:bg-slate-100 flex-shrink-0"
                                    aria-label="Close"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                            {/* Map fills the rest; PlotMap owns its own sticky action bar */}
                            <div className="flex-1 min-h-0">
                                <PlotMap
                                    existingGeoData={activePlot?.geoData}
                                    onPlotComplete={(geoData) => handleSaveMap(mappingPlotId.cropId, mappingPlotId.plotId, geoData)}
                                    onDone={() => setMappingPlotId(null)}
                                />
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Farm boundary modal — same full-bleed bottom-sheet / lg dialog
                pattern as the plot boundary overlay above. Without a saved
                canonical centre the weather endpoint 400s, so this is the
                pre-requisite entry point wired from the Identity card. */}
            {showFarmBoundary && myFarm && (
                <div className="fixed inset-0 z-[60] bg-slate-900/50 backdrop-blur-sm animate-in fade-in lg:flex lg:items-center lg:justify-center lg:p-6">
                    <div className="bg-white h-full w-full flex flex-col overflow-hidden lg:h-auto lg:max-h-[92vh] lg:max-w-3xl lg:rounded-3xl lg:shadow-2xl">
                        <div className="flex-shrink-0 bg-white/95 backdrop-blur-md border-b border-slate-100 px-4 py-3 flex items-center justify-between">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <div className="bg-emerald-100 text-emerald-600 p-1.5 rounded-lg flex-shrink-0">
                                    <MapPin size={16} />
                                </div>
                                <div className="leading-tight min-w-0">
                                    <p className="text-[11px] text-slate-500 truncate">
                                        Farm · <span className="font-semibold text-slate-700">{myFarm.name}</span>
                                    </p>
                                    <p className="text-sm font-bold text-slate-900">Draw farm boundary</p>
                                </div>
                            </div>
                            <button
                                onClick={() => { setShowFarmBoundary(false); setBoundaryError(null); }}
                                className="p-2 rounded-full text-slate-400 hover:bg-slate-100 flex-shrink-0"
                                aria-label="Close"
                                disabled={savingBoundary}
                            >
                                <X size={18} />
                            </button>
                        </div>
                        {boundaryError && (
                            <div className="flex-shrink-0 bg-red-50 border-b border-red-100 px-4 py-2 text-xs text-red-700 flex items-center gap-2">
                                <AlertTriangle size={14} /> {boundaryError}
                            </div>
                        )}
                        <div className="flex-1 min-h-0">
                            <PlotMap
                                onPlotComplete={(geoData) => { void handleSaveFarmBoundary(geoData); }}
                                onDone={handleFinishFarmBoundary}
                            />
                        </div>
                    </div>
                </div>
            )}

            <div className="flex flex-col lg:flex-row gap-6">

                {/* SIDEBAR NAVIGATION — full width on mobile/tablet (Android-like
                    flow), side-rail on lg+ desktops. A collapse toggle appears
                    only on lg+ so narrow viewports never lose content room. */}
                <div className={`w-full flex-shrink-0 transition-[width] duration-200 ${sidebarCollapsed ? 'lg:w-16' : 'lg:w-64'}`}>
                    <div className="bg-slate-50/50 p-2 rounded-2xl border border-slate-200 space-y-1">

                        {/* Header row: section title + collapse toggle (desktop only) */}
                        <div className="flex items-center justify-between">
                            <div className={`px-3 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
                                {t('profile.setupHub')}
                            </div>
                            <button
                                type="button"
                                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                                title={sidebarCollapsed ? 'Expand menu' : 'Collapse menu'}
                                aria-label={sidebarCollapsed ? 'Expand menu' : 'Collapse menu'}
                                className="hidden lg:inline-flex items-center justify-center ml-auto mr-1 h-8 w-8 rounded-lg text-slate-400 hover:bg-white hover:text-emerald-600 transition-colors"
                            >
                                {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
                            </button>
                        </div>

                        <TabItem id="identity" label={t('profile.farmerIdentity')} icon={<User size={20} />} />
                        <TabItem id="structure" label={t('profile.cropsAndPlots')} icon={<Sprout size={20} />} />
                        <TabItem id="utils" label={t('profile.waterAndPower')} icon={<Zap size={20} />} />
                        {/* <TabItem id="plan" label="Irrigation Plan" icon={<CalendarDays size={20} />} /> */}
                        <TabItem id="machines" label={t('profile.machinery')} icon={<Tractor size={20} />} />
                        <TabItem id="health" label="Soil & Crop Health" icon={<FlaskConical size={20} />} />
                        <TabItem id="intelligence" label={t('profile.intelligence')} icon={<BrainCircuit size={20} />} />

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

                {/* CONTENT AREA */}
                <div className="flex-1 min-w-0">

                    {/* 1. IDENTITY */}
                    {activeTab === 'identity' && (
                        <IdentitySection
                            profile={profile}
                            onUpdateProfile={onUpdateProfile}
                            onDeletePerson={onDeletePerson}
                            logout={logout}
                            myFarm={myFarm}
                            myMemberships={myMemberships}
                            farmDetails={farmDetails}
                            weatherConnected={weatherConnected}
                            connectingWeather={connectingWeather}
                            connectError={connectError}
                            handleConnectWeather={handleConnectWeather}
                            setShowFarmBoundary={setShowFarmBoundary}
                            handleOpenInviteQr={handleOpenInviteQr}
                            setShowMemberWizard={setShowMemberWizard}
                            nonExitableFarmIds={nonExitableFarmIds}
                            handleExitMembership={handleExitMembership}
                            isWorkerOnAnyFarm={isWorkerOnAnyFarm}
                            workerProfile={workerProfile}
                        />
                    )}



                    {/* PEOPLE (Now integrated into Identity) - REMOVING STANDALONE BLOCK */}

                    {/* 2. CROPS & PLOTS */}
                    {
                        activeTab === 'structure' && (
                            <StructureSection
                                crops={crops}
                                isAddingCrop={isAddingCrop}
                                setIsAddingCrop={setIsAddingCrop}
                                newCropData={newCropData}
                                setNewCropData={setNewCropData}
                                cropNameError={cropNameError}
                                setCropNameError={setCropNameError}
                                normalizeCropName={normalizeCropName}
                                normalizedNewCropName={normalizedNewCropName}
                                isDuplicateCropName={isDuplicateCropName}
                                handleAddCrop={handleAddCrop}
                                setMappingPlotId={setMappingPlotId}
                                deletePlot={deletePlot}
                                setWizardCropId={setWizardCropId}
                                onOpenScheduleLibrary={onOpenScheduleLibrary}
                            />
                        )}


                    {/* 3. UTILITIES */}
                    {activeTab === 'utils' && <UtilitiesSection profile={profile} onUpdate={onUpdateProfile} />}

                    {/* 5. MACHINERY */}
                    {activeTab === 'machines' && <MachinesSection profile={profile} onUpdate={onUpdateProfile} />}

                    {/* 7. SOIL & CROP HEALTH */}
                    {activeTab === 'health' && <HealthSection profile={profile} onUpdate={onUpdateProfile} />}

                    {/* 6. INTELLIGENCE */}
                    {activeTab === 'intelligence' && <IntelligenceSection />}

                </div>
            </div>
        </div>
    );
};

export default ProfilePage;
