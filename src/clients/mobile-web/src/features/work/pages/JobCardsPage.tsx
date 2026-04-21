/**
 * JobCardsPage — 6 banded sections by status.
 * CEI Phase 4 §4.8 Work Trust Ledger
 *
 * Sections:
 *   Draft         — stone, collapsible
 *   Assigned      — amber, expanded (default)
 *   InProgress    — amber, expanded
 *   Completed     — stone + "awaiting verification"
 *   VerifiedForPayout — emerald, prominent "Settle now"
 *   PaidOut (30d) — emerald muted, collapsed
 *   Cancelled     — rose, collapsed
 *
 * Filter chips: Draft / Assigned / In progress / Completed / Verified / Paid / All
 * Default active: Assigned
 */

import React, { useState, useCallback } from 'react';
import { useFarmContext } from '../../../core/session/FarmContext';
import { useJobCards } from '../hooks/useJobCards';
import JobCardRow from '../components/JobCardRow';
import CreateJobCardSheet from '../components/CreateJobCardSheet';
import AssignWorkerSheet from '../components/AssignWorkerSheet';
import PayoutConfirmationSheet from '../components/PayoutConfirmationSheet';
import type { JobCard, JobCardStatus } from '../../../domain/work/JobCard';

type FilterChip = 'Draft' | 'Assigned' | 'InProgress' | 'Completed' | 'VerifiedForPayout' | 'PaidOut' | 'All';

const FILTER_LABELS: Record<FilterChip, { en: string; mr: string }> = {
    Draft: { en: 'Draft', mr: 'मसुदा' },
    Assigned: { en: 'Assigned', mr: 'नेमणूक' },
    InProgress: { en: 'In progress', mr: 'सुरू' },
    Completed: { en: 'Completed', mr: 'पूर्ण' },
    VerifiedForPayout: { en: 'Verified', mr: 'तपासले' },
    PaidOut: { en: 'Paid', mr: 'पैसे दिले' },
    All: { en: 'All', mr: 'सर्व' },
};

interface BandConfig {
    statuses: JobCardStatus[];
    labelEn: string;
    labelMr: string;
    colorClass: string;
    defaultExpanded: boolean;
    subLabel?: string;
}

const BANDS: BandConfig[] = [
    { statuses: ['Draft'], labelEn: 'Draft', labelMr: 'मसुदा', colorClass: 'bg-stone-50 border-stone-200', defaultExpanded: false },
    { statuses: ['Assigned', 'InProgress'], labelEn: 'Active', labelMr: 'सक्रिय', colorClass: 'bg-amber-50 border-amber-200', defaultExpanded: true },
    { statuses: ['Completed'], labelEn: 'Completed', labelMr: 'पूर्ण', colorClass: 'bg-stone-50 border-stone-200', defaultExpanded: true, subLabel: 'awaiting verification' },
    { statuses: ['VerifiedForPayout'], labelEn: 'Verified — ready for payout', labelMr: 'तपासले — पेआउट तयार', colorClass: 'bg-emerald-50 border-emerald-300', defaultExpanded: true },
    { statuses: ['PaidOut'], labelEn: 'Paid out (30 days)', labelMr: 'पैसे दिले (३० दिवस)', colorClass: 'bg-emerald-50/50 border-emerald-100', defaultExpanded: false },
    { statuses: ['Cancelled'], labelEn: 'Cancelled', labelMr: 'रद्द', colorClass: 'bg-rose-50 border-rose-200', defaultExpanded: false },
];

interface JobCardsPageProps {
    onNavigateToDetail?: (jobCardId: string) => void;
}

const JobCardsPage: React.FC<JobCardsPageProps> = ({ onNavigateToDetail }) => {
    const { currentFarmId } = useFarmContext();
    const { jobCards, isLoading, assignJobCard, startJobCard, settleJobCard, cancelJobCard, refresh } = useJobCards({ farmId: currentFarmId });

    const [activeFilter, setActiveFilter] = useState<FilterChip>('Assigned');
    const [expandedBands, setExpandedBands] = useState<Record<string, boolean>>(
        Object.fromEntries(BANDS.map(b => [b.labelEn, b.defaultExpanded]))
    );

    const [showCreate, setShowCreate] = useState(false);
    const [assignTarget, setAssignTarget] = useState<JobCard | null>(null);
    const [settleTarget, setSettleTarget] = useState<JobCard | null>(null);

    const filteredCards = activeFilter === 'All'
        ? jobCards
        : jobCards.filter(c => {
            if (activeFilter === 'InProgress') return c.status === 'InProgress';
            return c.status === activeFilter;
        });

    // Apply 30-day cutoff to PaidOut
    const cutoff30d = new Date();
    cutoff30d.setDate(cutoff30d.getDate() - 30);
    const visibleCards = filteredCards.filter(c => {
        if (c.status === 'PaidOut') {
            return new Date(c.modifiedAtUtc) > cutoff30d;
        }
        return true;
    });

    const handleAction = useCallback((card: JobCard, action: string) => {
        if (action === 'assign') {
            setAssignTarget(card);
        } else if (action === 'start') {
            startJobCard(card.id).then(refresh);
        } else if (action === 'settle') {
            setSettleTarget(card);
        }
    }, [startJobCard, refresh]);

    const toggleBand = (labelEn: string) => {
        setExpandedBands(prev => ({ ...prev, [labelEn]: !prev[labelEn] }));
    };

    const cardsForBand = (band: BandConfig) => {
        return visibleCards.filter(c => band.statuses.includes(c.status));
    };

    return (
        <div className="flex flex-col min-h-screen bg-stone-50 pb-24">
            {/* Header */}
            <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-stone-100 px-4 pt-safe-area">
                <div className="flex items-center justify-between py-3">
                    <div>
                        <h1
                            style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                            className="text-base font-bold text-stone-900"
                        >
                            काम कार्डे
                        </h1>
                        <p
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                            className="text-xs text-stone-500"
                        >
                            Job Cards
                        </p>
                    </div>
                    <button
                        onClick={() => setShowCreate(true)}
                        className="rounded-xl bg-stone-900 text-white text-xs font-bold px-3 py-2"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        + New
                    </button>
                </div>

                {/* Filter chips */}
                <div className="flex gap-2 pb-3 overflow-x-auto no-scrollbar">
                    {(Object.keys(FILTER_LABELS) as FilterChip[]).map(f => (
                        <button
                            key={f}
                            onClick={() => setActiveFilter(f)}
                            className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${activeFilter === f
                                ? 'bg-stone-800 text-white'
                                : 'bg-stone-100 text-stone-600'
                                }`}
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        >
                            {FILTER_LABELS[f].en}
                        </button>
                    ))}
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 px-4 py-4 flex flex-col gap-4">
                {isLoading && (
                    <div className="flex items-center justify-center py-12">
                        <div className="w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                    </div>
                )}

                {!isLoading && visibleCards.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <p
                            style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                            className="text-base font-semibold text-stone-700"
                        >
                            कोणते काम कार्ड नाही
                        </p>
                        <p
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                            className="text-sm text-stone-400 mt-1"
                        >
                            No job cards — tap + New to create one
                        </p>
                    </div>
                )}

                {BANDS.map(band => {
                    const cards = cardsForBand(band);
                    if (cards.length === 0) return null;
                    const isExpanded = expandedBands[band.labelEn] ?? band.defaultExpanded;

                    return (
                        <div key={band.labelEn} className={`rounded-2xl border ${band.colorClass} overflow-hidden`}>
                            <button
                                onClick={() => toggleBand(band.labelEn)}
                                className="w-full flex items-center justify-between px-4 py-3"
                            >
                                <div className="flex items-center gap-2">
                                    <span
                                        style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                                        className="text-sm font-bold text-stone-800"
                                    >
                                        {band.labelMr}
                                    </span>
                                    <span
                                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                                        className="text-xs text-stone-500"
                                    >
                                        {band.subLabel ? `${band.labelEn} · ${band.subLabel}` : band.labelEn}
                                    </span>
                                    <span className="text-xs font-bold text-stone-600 bg-white/70 rounded-full px-1.5 py-0.5">
                                        {cards.length}
                                    </span>
                                </div>
                                <svg
                                    width="16" height="16" viewBox="0 0 24 24" fill="none"
                                    stroke="currentColor" strokeWidth="2"
                                    className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                >
                                    <path d="M6 9l6 6 6-6" />
                                </svg>
                            </button>

                            {isExpanded && (
                                <div className="px-3 pb-3 flex flex-col gap-3">
                                    {cards.map(card => (
                                        <JobCardRow
                                            key={card.id}
                                            card={card}
                                            onAction={handleAction}
                                            onPress={c => onNavigateToDetail?.(c.id)}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Sheets */}
            {showCreate && (
                <CreateJobCardSheet
                    farmId={currentFarmId ?? ''}
                    onClose={() => setShowCreate(false)}
                    onCreated={refresh}
                />
            )}

            {assignTarget && (
                <AssignWorkerSheet
                    card={assignTarget}
                    farmId={currentFarmId ?? ''}
                    onClose={() => setAssignTarget(null)}
                    onAssigned={async (req) => {
                        await assignJobCard(assignTarget.id, req);
                        setAssignTarget(null);
                        refresh();
                    }}
                />
            )}

            {settleTarget && (
                <PayoutConfirmationSheet
                    card={settleTarget}
                    onClose={() => setSettleTarget(null)}
                    onSettled={async (req) => {
                        await settleJobCard(settleTarget.id, req);
                        setSettleTarget(null);
                        refresh();
                    }}
                    onViewLedger={() => { /* parent can wire this */ }}
                />
            )}
        </div>
    );
};

export default JobCardsPage;
