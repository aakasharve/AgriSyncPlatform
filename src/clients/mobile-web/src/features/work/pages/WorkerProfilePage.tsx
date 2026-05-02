/**
 * WorkerProfilePage — route /workers/:userId
 * CEI Phase 4 §4.8
 *
 * UI:
 *   - Avatar + name + role
 *   - ReliabilityScoreCard
 *   - 30-day stats strip (jobs completed, paid out, earnings)
 *   - Job history list (last 20 cards)
 */

import React from 'react';
import { useFarmContext } from '../../../core/session/FarmContext';
import { useWorkerProfile } from '../hooks/useWorkerProfile';
import ReliabilityScoreCard from '../components/ReliabilityScoreCard';
import JobCardRow from '../components/JobCardRow';
import { getRoleLabel } from '../../../shared/roles/roleLabels';

interface WorkerProfilePageProps {
    userId: string;
    onBack: () => void;
    onNavigateToJobCard?: (jobCardId: string) => void;
    /** Display name + role (if known by parent) */
    displayName?: string;
    role?: string;
}

const getInitials = (name: string): string =>
    name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(w => w[0]?.toUpperCase() ?? '')
        .join('');

const WorkerProfilePage: React.FC<WorkerProfilePageProps> = ({
    userId,
    onBack,
    onNavigateToJobCard,
    displayName,
    role,
}) => {
    const { currentFarmId } = useFarmContext();
    const { profile, recentCards, isLoading } = useWorkerProfile(userId, currentFarmId);

    const resolvedName = profile?.displayName ?? displayName ?? 'Worker';
    const roleLabel = role ? getRoleLabel(role) : null;

    return (
        <div className="flex flex-col min-h-screen bg-stone-50 pb-24">
            {/* Header */}
            <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-stone-100 px-4 pt-safe-area">
                <div className="flex items-center gap-3 py-3">
                    <button onClick={onBack} className="p-1 -ml-1 text-stone-500">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M19 12H5M12 5l-7 7 7 7" />
                        </svg>
                    </button>
                    <div className="flex-1 min-w-0">
                        <h1
                            style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                            className="text-base font-bold text-stone-900 leading-tight truncate"
                        >
                            {resolvedName}
                        </h1>
                        <p
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                            className="text-xs text-stone-500"
                        >
                            Worker Profile
                        </p>
                    </div>
                </div>
            </div>

            <div className="flex-1 px-4 py-4 flex flex-col gap-4">
                {/* Avatar + identity */}
                <div className="rounded-2xl border border-stone-100 bg-white p-5 flex items-center gap-4">
                    <div className="w-14 h-14 rounded-full bg-stone-100 flex items-center justify-center text-lg font-black text-stone-600 shrink-0">
                        {getInitials(resolvedName)}
                    </div>
                    <div>
                        <p
                            className="text-base font-black text-stone-900"
                            style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                        >
                            {resolvedName}
                        </p>
                        {roleLabel && (
                            <span
                                className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold mt-1 ${roleLabel.badge}`}
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                            >
                                {roleLabel.display}
                            </span>
                        )}
                    </div>
                </div>

                {isLoading && (
                    <div className="flex items-center justify-center py-8">
                        <div className="w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                    </div>
                )}

                {/* Reliability score card */}
                {profile && (
                    <ReliabilityScoreCard score={profile.reliability} />
                )}

                {/* 30-day stats strip */}
                {profile && (
                    <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-2xl border border-stone-100 bg-white p-3 text-center">
                            <p
                                className="text-xl font-black text-stone-900"
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                            >
                                {profile.jobCardsLast30d}
                            </p>
                            <p
                                className="text-[10px] text-stone-400 font-semibold mt-0.5"
                                style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                            >
                                कामे
                            </p>
                            <p
                                className="text-[9px] text-stone-300"
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                            >
                                Jobs 30d
                            </p>
                        </div>
                        <div className="rounded-2xl border border-stone-100 bg-white p-3 text-center">
                            <p
                                className="text-xl font-black text-stone-900"
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                            >
                                {profile.jobCardsPaidOutLast30d}
                            </p>
                            <p
                                className="text-[10px] text-stone-400 font-semibold mt-0.5"
                                style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                            >
                                पैसे दिले
                            </p>
                            <p
                                className="text-[9px] text-stone-300"
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                            >
                                Paid out
                            </p>
                        </div>
                        <div className="rounded-2xl border border-emerald-50 bg-emerald-50 p-3 text-center">
                            <p
                                className="text-xl font-black text-emerald-800"
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                            >
                                {Math.round(profile.earnedLast30d / 1000)}k
                            </p>
                            <p
                                className="text-[10px] text-emerald-600 font-semibold mt-0.5"
                                style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                            >
                                कमाई
                            </p>
                            <p
                                className="text-[9px] text-emerald-400"
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                            >
                                {profile.earnedCurrencyCode}
                            </p>
                        </div>
                    </div>
                )}

                {/* Job history */}
                {recentCards.length > 0 && (
                    <div>
                        <p
                            className="text-[10px] font-bold uppercase tracking-wide text-stone-400 mb-2"
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        >
                            Recent Job Cards ({recentCards.length})
                        </p>
                        <div className="flex flex-col gap-3">
                            {recentCards.map(card => (
                                <JobCardRow
                                    key={card.id}
                                    card={card}
                                    onPress={c => onNavigateToJobCard?.(c.id)}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {!isLoading && !profile && (
                    <div className="text-center py-8">
                        <p
                            style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                            className="text-sm text-stone-500"
                        >
                            प्रोफाइल उपलब्ध नाही
                        </p>
                        <p
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                            className="text-xs text-stone-400 mt-1"
                        >
                            Profile data not available — check connection
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default WorkerProfilePage;
