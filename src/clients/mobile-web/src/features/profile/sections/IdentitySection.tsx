/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 6 — Identity tab section.
 *
 * Extracted verbatim from `pages/ProfilePage.tsx`'s `activeTab === 'identity'`
 * branch. State remains owned by the orchestrator (myFarm, farmDetails,
 * weather connect flow, memberships, worker profile) and is passed in as
 * props — keeps the refactor a pure move and lets the snapshot test stay
 * byte-equivalent.
 */

import React from 'react';
import {
    MapPin, Plus, Trash2, Clock,
    ChevronRight, CheckCircle2, ShieldCheck, Check, Users, Phone, AlertTriangle, FileText, Upload, Eye, LogOut,
    Cloud, QrCode, Medal
} from 'lucide-react';
import { FarmerProfile, OperatorCapability, VerificationStatus } from '../../../types';
import EntitlementBanner, { type SubscriptionSnapshotView } from '../../admin/billing/EntitlementBanner';
import MembershipsList from '../../people/components/MembershipsList';
import type { MyFarmDto, FarmDetailsDto } from '../../onboarding/qr/inviteApi';
import ReliabilityScoreCard from '../../work/components/ReliabilityScoreCard';
import type { WorkerProfileData } from '../../../domain/work/ReliabilityScore';
import { useLanguage } from '../../../i18n/LanguageContext';

// Identity verification status for farmer ID
type IdentityStatus = 'NOT_STARTED' | 'PENDING' | 'VERIFIED' | 'REJECTED';

// Identity status helper - maps VerificationStatus enum to IdentityStatus
const getIdentityStatus = (profile: FarmerProfile): IdentityStatus => {
    if (profile.verificationStatus === VerificationStatus.GovernmentVerified) return 'VERIFIED';
    if (profile.verificationStatus === VerificationStatus.PhoneVerified) return 'PENDING';
    if (profile.verificationStatus === VerificationStatus.Unverified) return 'NOT_STARTED';
    return 'PENDING'; // Default to PENDING to show the red banner
};

interface IdentitySectionProps {
    profile: FarmerProfile;
    onUpdateProfile: (p: FarmerProfile) => void;
    onDeletePerson?: (id: string) => void;
    logout: () => void;
    myFarm: { farmId: string; name: string; role: string; subscription: SubscriptionSnapshotView | null } | null;
    myMemberships: MyFarmDto[];
    farmDetails: FarmDetailsDto | null;
    weatherConnected: boolean;
    connectingWeather: boolean;
    connectError: string | null;
    handleConnectWeather: () => void;
    setShowFarmBoundary: (v: boolean) => void;
    handleOpenInviteQr: () => void;
    setShowMemberWizard: (v: boolean) => void;
    nonExitableFarmIds: Set<string>;
    handleExitMembership: (farmId: string, farmName: string) => Promise<void>;
    isWorkerOnAnyFarm: boolean;
    workerProfile: WorkerProfileData | null;
}

const IdentitySection: React.FC<IdentitySectionProps> = ({
    profile,
    onUpdateProfile,
    onDeletePerson,
    logout,
    myFarm,
    myMemberships,
    farmDetails,
    weatherConnected,
    connectingWeather,
    connectError,
    handleConnectWeather,
    setShowFarmBoundary,
    handleOpenInviteQr,
    setShowMemberWizard,
    nonExitableFarmIds,
    handleExitMembership,
    isWorkerOnAnyFarm,
    workerProfile,
}) => {
    const { t } = useLanguage();
    return (
        <div className="bg-transparent animate-in fade-in space-y-6">

            {/* 1. FARMER IDENTITY CARD (HIERARCHY LAYER 1) - ENHANCED WITH STATUS */}
            <div className="bg-white rounded-3xl shadow-sm border border-slate-100 relative overflow-hidden">

                {/* STATUS BANNER - Shows prominently based on verification status */}
                {(() => {
                    const identityStatus = getIdentityStatus(profile);
                    if (identityStatus === 'PENDING') {
                        return (
                            <div className="bg-red-500 text-white px-6 py-3 flex items-center gap-3">
                                <AlertTriangle size={20} />
                                <div>
                                    <p className="font-bold text-sm">⚠️ Farmer ID Pending</p>
                                    <p className="text-xs opacity-90">Complete verification to unlock trusted records</p>
                                </div>
                            </div>
                        );
                    }
                    if (identityStatus === 'NOT_STARTED') {
                        return (
                            <div className="bg-slate-600 text-white px-6 py-3 flex items-center gap-3">
                                <FileText size={20} />
                                <div>
                                    <p className="font-bold text-sm">Verification Not Started</p>
                                    <p className="text-xs opacity-90">Start verification to build trust</p>
                                </div>
                            </div>
                        );
                    }
                    if (identityStatus === 'REJECTED') {
                        return (
                            <div className="bg-orange-500 text-white px-6 py-3 flex items-center gap-3">
                                <AlertTriangle size={20} />
                                <div>
                                    <p className="font-bold text-sm">Verification Rejected</p>
                                    <p className="text-xs opacity-90">Please fix issues and resubmit</p>
                                </div>
                            </div>
                        );
                    }
                    return (
                        <div className="bg-emerald-500 text-white px-6 py-3 flex items-center gap-3">
                            <ShieldCheck size={20} />
                            <div>
                                <p className="font-bold text-sm">✓ Verified Farmer</p>
                                <p className="text-xs opacity-90">Government verified identity</p>
                            </div>
                        </div>
                    );
                })()}

                <div className="p-6">
                    <div className="absolute top-16 right-0 p-4 opacity-10 pointer-events-none">
                        <Medal size={120} className="text-emerald-900" />
                    </div>

                    <div className="flex items-start gap-5 relative z-10">
                        <div className="relative">
                            <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center text-3xl shadow-inner border-4 border-white">
                                👨‍🌾
                            </div>
                            {getIdentityStatus(profile) === 'VERIFIED' && (
                                <div className="absolute -bottom-1 -right-1 bg-emerald-500 text-white p-1.5 rounded-full border-2 border-white shadow-sm" title={t('profile.verified')}>
                                    <ShieldCheck size={16} />
                                </div>
                            )}
                            {getIdentityStatus(profile) === 'PENDING' && (
                                <div className="absolute -bottom-1 -right-1 bg-red-500 text-white p-1.5 rounded-full border-2 border-white shadow-sm" title="Pending">
                                    <Clock size={16} />
                                </div>
                            )}
                        </div>

                        <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
                                <h2 className="text-2xl font-black text-slate-800 break-words">{profile.name || '—'}</h2>
                                <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide border border-emerald-200 whitespace-nowrap">
                                    {t('profile.primaryOwner')}
                                </span>
                            </div>

                            <div className="flex flex-wrap gap-4 text-sm text-slate-500 mb-3">
                                <div className="flex items-center gap-1.5">
                                    <MapPin size={16} className="text-slate-400" />
                                    {profile.village || '—'}
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <Phone size={16} className="text-slate-400" />
                                    {profile.phone || '—'}
                                    {profile.phone && (
                                        <span className="text-emerald-600 text-xs font-bold flex items-center gap-1 bg-emerald-50 px-1.5 py-0.5 rounded">
                                            <Check size={10} /> {t('profile.verified')}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* DETAILED FIELDS - Always visible */}
                    <div className="mt-6 pt-6 border-t border-slate-100">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-4">Identity Details</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="bg-slate-50 rounded-xl p-3">
                                <p className="text-[10px] font-bold text-slate-400 uppercase">Full Name</p>
                                <p className="text-sm font-bold text-slate-700">{profile.name || '—'}</p>
                            </div>
                            <div className="bg-slate-50 rounded-xl p-3">
                                <p className="text-[10px] font-bold text-slate-400 uppercase">Mobile Number</p>
                                <p className="text-sm font-bold text-slate-700">{profile.phone || '—'}</p>
                            </div>
                            <div className="bg-slate-50 rounded-xl p-3">
                                <p className="text-[10px] font-bold text-slate-400 uppercase">Village / Taluka / District</p>
                                <p className="text-sm font-bold text-slate-700">{profile.village || '—'}</p>
                            </div>

                            <div className="bg-slate-50 rounded-xl p-3">
                                <p className="text-[10px] font-bold text-slate-400 uppercase">Land Record (7/12)</p>
                                <p className="text-sm font-bold text-slate-500 italic">Not uploaded</p>
                            </div>
                            <div className="bg-slate-50 rounded-xl p-3">
                                <p className="text-[10px] font-bold text-slate-400 uppercase">Identity Document</p>
                                <p className="text-sm font-bold text-red-600 flex items-center gap-1">
                                    <AlertTriangle size={12} /> Pending Upload
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* CTA BUTTONS based on status */}
                    <div className="mt-6">
                        {(() => {
                            const identityStatus = getIdentityStatus(profile);
                            if (identityStatus === 'NOT_STARTED') {
                                return (
                                    <button className="w-full py-3 bg-emerald-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-emerald-700 transition-colors shadow-lg">
                                        <Upload size={18} /> Start Verification
                                    </button>
                                );
                            }
                            if (identityStatus === 'PENDING') {
                                return (
                                    <button className="w-full py-3 bg-orange-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-orange-600 transition-colors shadow-lg">
                                        <Eye size={18} /> View Submitted Details
                                    </button>
                                );
                            }
                            if (identityStatus === 'REJECTED') {
                                return (
                                    <button className="w-full py-3 bg-red-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-red-600 transition-colors shadow-lg">
                                        <Upload size={18} /> Fix & Resubmit
                                    </button>
                                );
                            }
                            return (
                                <button className="w-full py-3 bg-slate-100 text-slate-600 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-slate-200 transition-colors">
                                    <Eye size={18} /> View Verified Identity
                                </button>
                            );
                        })()}
                    </div>

                    {/* FARM BOUNDARY + WEATHER LINK — three-state flow:
                        A) no boundary → red "weather pending" + amber Draw CTA
                        B) boundary drawn, weather not yet connected → emerald
                           boundary tile + sky-blue "Connect Farm to Weather" CTA
                        C) connected → single emerald confirmation row
                        Lives directly under the Farmer ID CTA so owners treat it
                        as the second "prove who/what you farm" step. */}
                    {myFarm && (() => {
                        const hasBoundary = !!(farmDetails?.canonicalCentreLat != null && farmDetails?.canonicalCentreLng != null);
                        const acres = farmDetails?.totalMappedAreaAcres;

                        // STATE C — boundary drawn AND weather connected
                        if (hasBoundary && weatherConnected) {
                            return (
                                <div className="mt-4">
                                    <div className="w-full rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white px-4 py-3 flex items-center gap-3">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white flex-shrink-0">
                                            <CheckCircle2 size={18} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-bold text-emerald-800">
                                                Farm boundary drawn · Weather connected
                                            </p>
                                            <p className="text-xs text-emerald-700/80">
                                                {acres != null ? `${Number(acres).toFixed(2)} acres mapped · ` : ''}Live weather is on your daily log.
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setShowFarmBoundary(true)}
                                            className="text-xs font-semibold text-emerald-700 underline hover:text-emerald-900 flex-shrink-0"
                                        >
                                            Redraw
                                        </button>
                                    </div>
                                </div>
                            );
                        }

                        // STATE B — boundary drawn, weather not yet connected
                        if (hasBoundary) {
                            return (
                                <div className="mt-4 space-y-3">
                                    <button
                                        onClick={() => setShowFarmBoundary(true)}
                                        className="w-full text-left rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white px-4 py-3 hover:border-emerald-300 transition-colors flex items-center gap-3"
                                    >
                                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white flex-shrink-0">
                                            <MapPin size={18} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <p className="text-sm font-bold text-emerald-800">Farm boundary drawn</p>
                                                <CheckCircle2 size={14} className="text-emerald-500" />
                                            </div>
                                            <p className="text-xs text-emerald-700/80">
                                                {acres != null ? `${Number(acres).toFixed(2)} acres · ` : ''}Tap to redraw
                                            </p>
                                        </div>
                                        <ChevronRight size={18} className="text-emerald-400 flex-shrink-0" />
                                    </button>

                                    <div className="rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-3">
                                        <button
                                            type="button"
                                            onClick={() => { void handleConnectWeather(); }}
                                            disabled={connectingWeather}
                                            className="w-full py-3 bg-sky-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-sky-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-md"
                                        >
                                            <Cloud size={18} />
                                            {connectingWeather ? 'Connecting…' : 'Connect Farm to Weather · हवामान जोडा'}
                                        </button>
                                        <p className="mt-2 text-[11px] text-sky-900/70 text-center px-2">
                                            We'll use your farm's location to fetch live rainfall, temperature, and a 5-day forecast for your daily log.
                                        </p>
                                        {connectError && (
                                            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                                                {connectError}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        }

                        // STATE A — no boundary drawn yet
                        return (
                            <div className="mt-4 space-y-3">
                                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 flex items-start gap-2.5">
                                    <AlertTriangle size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-bold text-red-800">
                                            Weather pending · हवामान बंद आहे
                                        </p>
                                        <p className="text-[11px] text-red-700/90 mt-0.5">
                                            Without drawing your farm boundary, live weather can't show on your daily log.
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setShowFarmBoundary(true)}
                                    className="w-full py-3 bg-amber-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-amber-600 transition-colors shadow-lg"
                                >
                                    <MapPin size={18} /> Draw Farm Boundary
                                </button>
                                <p className="text-[11px] text-slate-500 text-center">
                                    Unlocks live weather & activity anchoring for your farm.
                                </p>
                            </div>
                        );
                    })()}

                    {/* LOGOUT ACTION */}
                    <div className="mt-4 pt-4 border-t border-slate-100 flex justify-center">
                        <button
                            onClick={logout}
                            className="text-red-500 font-bold text-sm flex items-center gap-2 px-6 py-3 rounded-xl hover:bg-red-50 transition-colors"
                        >
                            <LogOut size={16} /> Log Out
                        </button>
                    </div>
                </div>
            </div>



            {/* Phase 5 entitlement banner — only renders for owners with
                subscription trouble or a trial. Workers never see this. */}
            {myFarm && (
                <EntitlementBanner
                    subscription={myFarm.subscription}
                    role={myFarm.role}
                />
            )}

            {/* Phase 6: Your memberships list with exit flow.
                Only renders if the user has farms — zero-farm users
                already have the FirstFarmWizard open from AppContent. */}
            {myMemberships.length > 0 && (
                <MembershipsList
                    farms={myMemberships}
                    nonExitableFarmIds={nonExitableFarmIds}
                    onExit={handleExitMembership}
                />
            )}

            {/* CEI Phase 4 §4.8 — own reliability score (Worker/Mukadam only) */}
            {isWorkerOnAnyFarm && workerProfile && (
                <div>
                    <p
                        className="text-[10px] font-bold uppercase tracking-wide text-stone-400 mb-2 px-1"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        Your reliability
                    </p>
                    <ReliabilityScoreCard
                        score={workerProfile.reliability}
                    />
                </div>
            )}

            {/* 2. FARM TEAM HIERARCHY (LAYERS 2 & 3) */}
            <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                            <Users size={20} className="text-emerald-600" />
                            {t('profile.myFarmTeam')}
                        </h3>
                        <p className="text-xs text-slate-400 mt-1">{t('profile.manageAccess')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleOpenInviteQr}
                            className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-lg shadow-emerald-200 active:scale-95 transition-all flex items-center gap-2"
                        >
                            <QrCode size={16} /> Share farm QR
                        </button>
                        <button
                            onClick={() => setShowMemberWizard(true)}
                            className="bg-white text-slate-900 border border-slate-200 px-4 py-2 rounded-xl text-sm font-bold shadow-sm active:scale-95 transition-all flex items-center gap-2"
                        >
                            <Plus size={16} /> {t('profile.addMember')}
                        </button>
                    </div>
                </div>

                {/* Prominent invite banner — visible when the team is empty so a first-time farmer knows the QR exists. */}
                {(!profile.operators || profile.operators.length === 0) && (
                    <button
                        onClick={handleOpenInviteQr}
                        className="mb-4 w-full text-left rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white px-4 py-4 shadow-sm hover:border-emerald-300 transition-colors"
                    >
                        <div className="flex items-center gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-600 text-white">
                                <QrCode size={20} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="font-bold text-emerald-800">कामगारांना जोडा · Add your workers</div>
                                <div className="text-xs text-emerald-700/80">Show them the farm QR. They scan, enter phone, done.</div>
                            </div>
                        </div>
                    </button>
                )}

                <div className="space-y-3">
                    {/* Existing People or Dummies if none */}
                    {(profile.operators && profile.operators.length > 0) ? (
                        profile.operators.map(person => {
                            const canLog = person.capabilities?.includes(OperatorCapability.LOG_DATA);
                            return (
                                <div key={person.id} className="flex items-center gap-4 p-4 bg-white rounded-2xl border border-slate-100 shadow-sm hover:border-emerald-100 transition-all group">

                                    {/* Avatar */}
                                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg shadow-inner ${person.role === 'SECONDARY_OWNER' ? 'bg-blue-100 text-blue-600' : 'bg-orange-100 text-orange-600'}`}>
                                        {person.name.charAt(0)}
                                    </div>

                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                        <h4 className="font-bold text-slate-800 text-base truncate">{person.name}</h4>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg uppercase tracking-wide border ${person.role === 'SECONDARY_OWNER' ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-orange-50 text-orange-700 border-orange-100'}`}>
                                                {person.role === 'SECONDARY_OWNER' ? t('profile.partner') : t('profile.worker')}
                                            </span>
                                            {person.phone && <span className="text-[10px] text-slate-400 font-medium">{person.phone}</span>}
                                        </div>
                                    </div>

                                    {/* Toggle Actions */}
                                    <div className="flex items-center gap-3">
                                        {/* Allow Log Toggle */}
                                        <div
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const newCaps = canLog
                                                    ? (person.capabilities || []).filter(c => c !== OperatorCapability.LOG_DATA)
                                                    : [...(person.capabilities || []), OperatorCapability.LOG_DATA];
                                                const updatedOperators = profile.operators!.map(p => p.id === person.id ? { ...p, capabilities: newCaps } : p);
                                                onUpdateProfile({ ...profile, operators: updatedOperators });
                                            }}
                                            className={`cursor-pointer flex items-center gap-2 px-3 py-2 rounded-xl border transition-all select-none ${canLog ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'}`}
                                        >
                                            <span className={`text-[10px] font-bold uppercase ${canLog ? 'text-emerald-700' : 'text-slate-400'}`}>{t('profile.allowLog')}</span>
                                            <div className={`w-8 h-4 rounded-full relative transition-colors ${canLog ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                                                <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-transform ${canLog ? 'translate-x-4' : ''}`} />
                                            </div>
                                        </div>

                                        <button
                                            // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- T-IGH-04 ratchet: intentional side-effect-only expression; revisit in V2.
                                            onClick={(e) => { e.stopPropagation(); onDeletePerson && onDeletePerson(person.id); }}
                                            className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div className="text-center p-8 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                            <div className="w-12 h-12 bg-slate-100 text-slate-300 rounded-full flex items-center justify-center mx-auto mb-3">
                                <Users size={24} />
                            </div>
                            <p className="text-sm font-bold text-slate-500">{t('profile.noTeamMembers')}</p>
                            <p className="text-xs text-slate-400">{t('profile.addFamilyOrWorkers')}</p>
                        </div>
                    )}
                </div>
            </div>

        </div>
    );
};

export default IdentitySection;
