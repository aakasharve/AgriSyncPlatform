/**
 * ComplianceSignalsPage — CEI Phase 3 §4.6
 *
 * Shows farm compliance signals grouped by severity band.
 * Accessible from AttentionCard chips and the "•••" overflow.
 */

import React from 'react';
import { useFarmContext } from '../../../core/session/FarmContext';
import { useComplianceSignals } from '../hooks/useComplianceSignals';
import SignalCard from '../components/SignalCard';
import type { AppRoute } from '../../../domain/types/farm.types';
import type { ComplianceSignalDto } from '../data/complianceClient';

interface ComplianceSignalsPageProps {
    onNavigate?: (route: AppRoute) => void;
    onBack?: () => void;
    /** Optional pre-filter to a specific plot */
    plotId?: string;
}

type Filter = 'Open' | 'Acknowledged' | 'Resolved' | 'All';
type Severity = 'Critical' | 'NeedsAttention' | 'Watch' | 'Info';

const SEVERITY_ORDER: Severity[] = ['Critical', 'NeedsAttention', 'Watch', 'Info'];

const BAND_CONFIG: Record<Severity, { labelEn: string; labelMr: string; colorClass: string; defaultExpanded: boolean }> = {
    Critical: { labelEn: 'Critical', labelMr: 'गंभीर', colorClass: 'bg-rose-50 border-rose-200', defaultExpanded: true },
    NeedsAttention: { labelEn: 'Needs Attention', labelMr: 'लक्ष द्या', colorClass: 'bg-amber-50 border-amber-200', defaultExpanded: true },
    Watch: { labelEn: 'Watch', labelMr: 'नजर ठेवा', colorClass: 'bg-stone-50 border-stone-200', defaultExpanded: false },
    Info: { labelEn: 'Info', labelMr: 'माहिती', colorClass: 'bg-emerald-50 border-emerald-200', defaultExpanded: false },
};

const FILTER_LABELS: Record<Filter, string> = {
    Open: 'Open',
    Acknowledged: 'Seen',
    Resolved: 'Done',
    All: 'All',
};

const ComplianceSignalsPage: React.FC<ComplianceSignalsPageProps> = ({ onNavigate, onBack, plotId }) => {
    const { currentFarmId } = useFarmContext();
    const { signals, isLoading, filter, setFilter, refresh } = useComplianceSignals(currentFarmId ?? null);
    const [expandedBands, setExpandedBands] = React.useState<Record<Severity, boolean>>({
        Critical: true,
        NeedsAttention: true,
        Watch: false,
        Info: false,
    });

    const filteredSignals = plotId
        ? signals.filter(s => s.plotId === plotId)
        : signals;

    const byBand: Record<Severity, ComplianceSignalDto[]> = {
        Critical: filteredSignals.filter(s => s.severity === 'Critical'),
        NeedsAttention: filteredSignals.filter(s => s.severity === 'NeedsAttention'),
        Watch: filteredSignals.filter(s => s.severity === 'Watch'),
        Info: filteredSignals.filter(s => s.severity === 'Info'),
    };

    const totalOpen = filteredSignals.filter(s => s.isOpen).length;

    return (
        <div className="flex flex-col min-h-screen bg-stone-50 pb-24">
            {/* Header */}
            <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-stone-100 px-4 pt-safe-area">
                <div className="flex items-center justify-between py-3">
                    {onBack && (
                        <button onClick={onBack} className="text-stone-500 p-1 -ml-1">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
                        </button>
                    )}
                    <div className="flex-1 min-w-0 ml-2">
                        <h1 style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }} className="text-base font-bold text-stone-900 leading-tight">
                            चेतावण्या
                        </h1>
                        <p style={{ fontFamily: "'DM Sans', sans-serif" }} className="text-xs text-stone-500">
                            Signals {totalOpen > 0 ? `• ${totalOpen} open` : ''}
                        </p>
                    </div>
                </div>

                {/* Filter chips */}
                <div className="flex gap-2 pb-3 overflow-x-auto no-scrollbar">
                    {(Object.keys(FILTER_LABELS) as Filter[]).map(f => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${filter === f
                                ? 'bg-stone-800 text-white'
                                : 'bg-stone-100 text-stone-600'
                                }`}
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        >
                            {FILTER_LABELS[f]}
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

                {!isLoading && filteredSignals.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <p style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }} className="text-base font-semibold text-stone-700">
                            कोणत्याही चेतावण्या नाहीत
                        </p>
                        <p style={{ fontFamily: "'DM Sans', sans-serif" }} className="text-sm text-stone-400 mt-1">
                            No signals — your farms are on track
                        </p>
                    </div>
                )}

                {SEVERITY_ORDER.map(sev => {
                    const items = byBand[sev];
                    if (items.length === 0) return null;
                    const { labelEn, labelMr, colorClass } = BAND_CONFIG[sev];
                    const isExpanded = expandedBands[sev];

                    return (
                        <div key={sev} className={`rounded-2xl border ${colorClass} overflow-hidden`}>
                            <button
                                onClick={() => setExpandedBands(prev => ({ ...prev, [sev]: !prev[sev] }))}
                                className="w-full flex items-center justify-between px-4 py-3"
                            >
                                <div className="flex items-center gap-2">
                                    <span style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }} className="text-sm font-bold text-stone-800">{labelMr}</span>
                                    <span style={{ fontFamily: "'DM Sans', sans-serif" }} className="text-xs text-stone-500">{labelEn}</span>
                                    <span className="text-xs font-bold text-stone-600 bg-white/70 rounded-full px-1.5 py-0.5">{items.length}</span>
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
                                    {items.map(signal => (
                                        <SignalCard
                                            key={signal.id}
                                            signal={signal}
                                            onNavigate={onNavigate}
                                            onMutated={refresh}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default ComplianceSignalsPage;
