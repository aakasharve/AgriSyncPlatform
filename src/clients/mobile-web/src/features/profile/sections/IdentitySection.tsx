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
    MapPin,
    ChevronRight, CheckCircle2, ShieldCheck, Check, Users, Phone, AlertTriangle, LogOut,
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

/** The account's own number as the server reports it: a masked form and whether a code proved it. */
export interface SignedInPhone {
    masked: string;
    verified: boolean;
}

/**
 * Lane HONESTY-2 (H4) — is the number shown on this page the one this account signed in with, proven by a code?
 * The server masks the number (`******3210`), so all the phone can compare is the last digits and the length: a
 * typed number passes only if every digit the mask shows is the same digit in the same place. No number, no
 * account number, or one a code never proved → false (no tick).
 */
export function phoneIsVerifiedSignIn(typed: string | null | undefined, signedIn: SignedInPhone | null | undefined): boolean {
    if (!typed || !signedIn?.verified) return false;
    const typedDigits = typed.replace(/\D/g, '');
    // Both sides to the last ten places (the national number): a "+91" or "0" in front is not part of the comparison.
    const mask = signedIn.masked.replace(/[^*\d]/g, '').slice(-10);
    const digits = typedDigits.slice(-10);
    if (mask.length < 4 || digits.length !== mask.length) return false;
    return [...mask].every((ch, i) => ch === '*' || ch === digits[i]);
}

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
     * lane 2b (D-15 via D-26) — the server lets this person change the farm's setup (the boundary
     * is "edit farm setup"). False: no draw / redraw door, since the server would refuse it (P5).
     * Absent = true (callers from before 2b).
     */
    canEditFarmSetup?: boolean;
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
    /**
     * lane HONESTY-2 (H4) — the number this account signed in with, as the SERVER holds it (`/me/context` → `me`):
     * `masked` is the server's own mask (`******3210`, nothing but the last four digits) and `verified` is true only
     * when a code sent to that number was entered (`phoneVerifiedAtUtc`). The "सत्यापित" tick beside the phone shows
     * only for that number. Absent = no tick (the page cannot say it).
     */
    signedInPhone?: SignedInPhone | null;
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
    canEditFarmSetup = true,
    onOpenTeam,
    nonExitableFarmIds,
    handleExitMembership,
    signedInPhone = null,
}) => {
    const { t } = useLanguage();
    // H4: the only identity statement this page can honestly make is a government-verified one (the same single truth
    // the सेट-अप केंद्र reads). Nothing in the app sets it for a farmer today, so today no banner and no badge is drawn.
    const isGovernmentVerified = profile.verificationStatus === VerificationStatus.GovernmentVerified;
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

                {/* STATUS BANNER — lane HONESTY-2 (H4). There is no identity-review process in the app, so there is no
                    "being checked", "not started" or "rejected" to state: those three banners (one in English) are gone, and
                    so is the "start / view / resubmit" button under each. Only a government-verified identity (the same
                    one truth the सेट-अप केंद्र reads, PLR-D9 T4) is announced. */}
                {isGovernmentVerified && (
                    <div className="bg-emerald-500 text-white px-6 py-3 flex items-center gap-3" data-testid="identity-verified-banner">
                        <ShieldCheck size={20} />
                        <p className="font-bold text-sm">✓ ओळख पडताळलेली</p>
                    </div>
                )}

                <div className="p-6">
                    <div className="absolute top-16 right-0 p-4 opacity-10 pointer-events-none">
                        <Medal size={120} className="text-emerald-900" />
                    </div>

                    <div className="flex items-start gap-5 relative z-10">
                        <div className="relative shrink-0">
                            <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center text-3xl shadow-inner border-4 border-white">
                                👨‍🌾
                            </div>
                            {isGovernmentVerified && (
                                <div className="absolute -bottom-1 -right-1 bg-emerald-500 text-white p-1.5 rounded-full border-2 border-white shadow-sm" title={t('profile.verified')}>
                                    <ShieldCheck size={16} />
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
                                    {/* H4: "सत्यापित" only for the number this account signed in with (a code was entered for it),
                                        never for any other number that happens to be typed in the profile. */}
                                    {phoneIsVerifiedSignIn(profile.phone, signedInPhone) && (
                                        <span data-testid="identity-phone-verified" className="text-emerald-600 text-xs font-bold flex shrink-0 items-center gap-1 bg-emerald-50 px-1.5 py-0.5 rounded">
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
                            {/* H4: "सातबारा (7/12): अजून जोडलेले नाही" and "ओळखपत्र: जोडायचे बाकी" are gone — the app has no way to add
                                either, so they only promised something that cannot be done. The four buttons that sat below
                                (Start Verification / View Submitted Details / Fix & Resubmit / पडताळलेली ओळख पहा) had no handler. */}
                        </div>
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
                        // lane 2b: drawing the boundary is edit-farm-setup; without it only the
                        // finished state is shown, and with no redraw door.
                        if (!canEditFarmSetup && !(hasBoundary && weatherConnected)) return null;

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
                                        {canEditFarmSetup && (
                                            <button
                                                type="button"
                                                onClick={() => setShowFarmBoundary(true)}
                                                className="text-xs font-semibold text-emerald-700 underline hover:text-emerald-900 flex-shrink-0"
                                            >
                                                Redraw
                                            </button>
                                        )}
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
