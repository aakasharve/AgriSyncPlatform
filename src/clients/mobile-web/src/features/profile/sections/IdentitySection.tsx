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
    MapPin, Clock,
    ChevronRight, CheckCircle2, ShieldCheck, Check, Users, Phone, AlertTriangle, FileText, Upload, Eye, LogOut,
    Cloud, Medal
} from 'lucide-react';
import { FarmerProfile, VerificationStatus } from '../../../types';
import EntitlementBanner, { type SubscriptionSnapshotView } from '../../admin/billing/EntitlementBanner';
import MembershipsList from '../../people/components/MembershipsList';
import PendingJoinRequests from '../../onboarding/components/PendingJoinRequests';
import type { MyFarmDto, FarmDetailsDto } from '../../onboarding/qr/inviteApi';
import { isOwnerTierRole } from '../helpers/teamRoster';
import { RowLink } from '../../../shared/components/ui/placeUi';
import { TEAM_COPY } from '../team/teamCopy';
import { useLanguage } from '../../../i18n/LanguageContext';
import { getOperatorRoleLabel } from '../../../shared/roles/roleLabels';
import { isActiveSeat } from '../../../core/session/seatStatus';

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
    logout: () => void;
    myFarm: { farmId: string; name: string; role: string; subscription: SubscriptionSnapshotView | null } | null;
    myMemberships: MyFarmDto[];
    /** spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — seats that grant nothing yet (a waiting request, a pause). */
    pendingSeats?: MyFarmDto[];
    /** The app's current farm (FarmContext). Its server role is the role shown beside the name. */
    currentFarmId?: string | null;
    farmDetails: FarmDetailsDto | null;
    weatherConnected: boolean;
    connectingWeather: boolean;
    connectError: string | null;
    handleConnectWeather: () => void;
    setShowFarmBoundary: (v: boolean) => void;
    /**
     * spec: plr-d7-m1-multiuser-2026-10-26 (step 2, P-4 / MU-10) — the team moved to its own page
     * (सेट-अप केंद्र → माणसं → माझी टीम), where the farm QR now opens. Kept so older callers still
     * type-check; this page no longer reads it.
     */
    handleOpenInviteQr?: () => void;
    /** Opens "माझी टीम" (ProfilePage decides for whom: owner tier, or a मुकादम to look): a plain
     *  door from where the team used to live. */
    onOpenTeam?: () => void;
    nonExitableFarmIds: Set<string>;
    handleExitMembership: (farmId: string, farmName: string) => Promise<void>;
    isWorkerOnAnyFarm: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    workerProfile: { reliability: any } | null;
}

const IdentitySection: React.FC<IdentitySectionProps> = ({
    profile,
    logout,
    myFarm,
    myMemberships,
    pendingSeats = [],
    currentFarmId,
    farmDetails,
    weatherConnected,
    connectingWeather,
    connectError,
    handleConnectWeather,
    setShowFarmBoundary,
    onOpenTeam,
    nonExitableFarmIds,
    handleExitMembership,
}) => {
    const { t } = useLanguage();
    // spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the chip beside the name said "मुख्य मालक" to
    // EVERYONE, a worker included. It now says the role the SERVER holds for the current farm
    // (/farms/mine), falling back to the farm this page loaded; no server answer, no chip.
    // F3: a seat that is not Active (a typed-code request waiting for the owner) carries the
    // placeholder role "Worker", which nobody granted — such a seat shows NO chip, never "कामगार".
    const currentSeat = currentFarmId ? myMemberships.find(m => m.farmId === currentFarmId) : undefined;
    const serverRole = currentSeat
        ? (isActiveSeat(currentSeat) ? currentSeat.role : null)
        : (myFarm?.role ?? null);
    // The team (linked people, requests, the farm QR, named workers) is its own page now
    // ("माझी टीम", spec plr-d7-m1 step 2); the roster route is owner/co-owner-only, so the door is
    // offered only to whom ProfilePage passes it (owner tier, or a मुकादम to look).
    const teamLine = isOwnerTierRole(myFarm?.role) ? TEAM_COPY.hubLine : TEAM_COPY.crewLine;
    return (
        <div className="bg-transparent animate-in fade-in space-y-6">

            {/* 1. FARMER IDENTITY CARD (HIERARCHY LAYER 1) - ENHANCED WITH STATUS */}
            <div className="bg-white rounded-3xl shadow-sm border border-slate-100 relative overflow-hidden">

                {/* STATUS BANNER - Shows prominently based on verification status */}
                {(() => {
                    const identityStatus = getIdentityStatus(profile);
                    if (identityStatus === 'PENDING') {
                        return (
                            <div className="bg-amber-500 text-white px-6 py-3 flex items-center gap-3">
                                <Clock size={20} />
                                <div>
                                    <p className="font-bold text-sm">ओळख तपासली जात आहे</p>
                                    <p className="text-xs opacity-90">पडताळणी पूर्ण झाल्यावर विश्वासू नोंदी सुरू होतील</p>
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
                    // spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — "Verified Farmer" dropped: the
                    // same plain words the सेट-अप केंद्र uses for a verified identity (PLR-D9 T4).
                    return (
                        <div className="bg-emerald-500 text-white px-6 py-3 flex items-center gap-3">
                            <ShieldCheck size={20} />
                            <p className="font-bold text-sm">✓ ओळख पडताळलेली</p>
                        </div>
                    );
                })()}

                <div className="p-6">
                    <div className="absolute top-16 right-0 p-4 opacity-10 pointer-events-none">
                        <Medal size={120} className="text-emerald-900" />
                    </div>

                    <div className="flex items-start gap-5 relative z-10">
                        <div className="relative shrink-0">
                            <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center text-3xl shadow-inner border-4 border-white">
                                👨‍🌾
                            </div>
                            {getIdentityStatus(profile) === 'VERIFIED' && (
                                <div className="absolute -bottom-1 -right-1 bg-emerald-500 text-white p-1.5 rounded-full border-2 border-white shadow-sm" title={t('profile.verified')}>
                                    <ShieldCheck size={16} />
                                </div>
                            )}
                            {getIdentityStatus(profile) === 'PENDING' && (
                                <div className="absolute -bottom-1 -right-1 bg-amber-500 text-white p-1.5 rounded-full border-2 border-white shadow-sm" title="Under review">
                                    <Clock size={16} />
                                </div>
                            )}
                        </div>

                        <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
                                <h2 className="min-w-0 max-w-full text-2xl font-black text-slate-800 [overflow-wrap:anywhere]">{profile.name || '—'}</h2>
                                {serverRole && (
                                    <span data-testid="identity-role-chip" className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide border border-emerald-200 whitespace-nowrap">
                                        {getOperatorRoleLabel(serverRole).mr}
                                    </span>
                                )}
                            </div>

                            <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-2 text-sm text-slate-500 mb-3">
                                <div className="flex min-w-0 max-w-full items-center gap-1.5">
                                    <MapPin size={16} className="shrink-0 text-slate-400" />
                                    {profile.village || '—'}
                                </div>
                                <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-1">
                                    <Phone size={16} className="shrink-0 text-slate-400" />
                                    {profile.phone || '—'}
                                    {profile.phone && (
                                        <span className="text-emerald-600 text-xs font-bold flex shrink-0 items-center gap-1 bg-emerald-50 px-1.5 py-0.5 rounded">
                                            <Check size={10} /> {t('profile.verified')}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* DETAILED FIELDS - Always visible */}
                    <div className="mt-6 pt-6 border-t border-slate-100">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-4">ओळख तपशील</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="bg-slate-50 rounded-xl p-3">
                                <p className="text-[10px] font-bold text-slate-400 uppercase">पूर्ण नाव</p>
                                <p className="text-sm font-bold text-slate-700">{profile.name || '—'}</p>
                            </div>
                            <div className="bg-slate-50 rounded-xl p-3">
                                <p className="text-[10px] font-bold text-slate-400 uppercase">मोबाईल नंबर</p>
                                <p className="text-sm font-bold text-slate-700">{profile.phone || '—'}</p>
                            </div>
                            <div className="bg-slate-50 rounded-xl p-3">
                                <p className="text-[10px] font-bold text-slate-400 uppercase">गाव / तालुका / जिल्हा</p>
                                <p className="text-sm font-bold text-slate-700">{profile.village || '—'}</p>
                            </div>

                            <div className="bg-slate-50 rounded-xl p-3">
                                <p className="text-[10px] font-bold text-slate-400 uppercase">सातबारा (7/12)</p>
                                <p className="text-sm font-bold text-slate-500">अजून जोडलेले नाही</p>
                            </div>
                            <div className="bg-slate-50 rounded-xl p-3">
                                <p className="text-[10px] font-bold text-slate-400 uppercase">ओळखपत्र</p>
                                <p className="text-sm font-bold text-amber-600 flex items-center gap-1">
                                    <Clock size={12} /> जोडायचे बाकी
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
                                    <Eye size={18} /> पडताळलेली ओळख पहा
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

                                    <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-emerald-50/40 to-white p-4 shadow-sm">
                                        <div className="flex items-start gap-3">
                                            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md shadow-emerald-200/70">
                                                <Cloud size={24} />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-bold text-emerald-900">हवामान जोडा</p>
                                                <p className="mt-0.5 text-[11px] leading-relaxed text-emerald-800/70">
                                                    थेट पाऊस, तापमान आणि ५ दिवसांचा अंदाज तुमच्या रोजच्या नोंदीत दिसेल
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => { void handleConnectWeather(); }}
                                            disabled={connectingWeather}
                                            className="mt-3 w-full py-3.5 bg-gradient-to-b from-emerald-500 to-emerald-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:from-emerald-600 hover:to-emerald-700 active:scale-[0.98] active:from-emerald-700 active:to-emerald-800 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-lg shadow-emerald-200/60"
                                        >
                                            <Cloud size={18} />
                                            {connectingWeather ? 'जोडत आहे…' : 'आता जोडा'}
                                        </button>
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

            {/* spec: plr-d7-m1-multiuser-2026-10-26 (step 1, M1) — a request this person sent
                (typed farm code) that the owner has not answered, or a paused seat. Not a farm he
                is in, so not in the list above; listed here so a request can be withdrawn. */}
            {pendingSeats.length > 0 && (
                <PendingJoinRequests
                    seats={pendingSeats}
                    onWithdraw={farmId => handleExitMembership(farmId, '')}
                    testId="profile-pending-seats"
                />
            )}

            {/* The own-reliability card was REMOVED, not hidden behind a flag:
                the server computes it from zero metrics, so every worker read
                100 (ReliabilityScore.cs). Trust score is deferred by founder
                decision; this returns only with a real metrics read-model. */}

            {/* spec: plr-d7-m1-multiuser-2026-10-26 (step 2, P-4) — the team moved out of ओळख to
                its own page; this is the door to it from where it used to be. Every team control
                (QR, requests, pause / remove, हजेरी व पक्कं, named workers) lives there now. */}
            {onOpenTeam && (
                <RowLink testId="identity-open-team" icon={<Users size={22} aria-hidden="true" />} tone="blue"
                    title={TEAM_COPY.pageTitle} line={teamLine} onClick={onOpenTeam} />
            )}

        </div>
    );
};

export default IdentitySection;
