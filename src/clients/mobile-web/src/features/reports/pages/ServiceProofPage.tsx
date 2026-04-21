/**
 * ServiceProofPage — CEI Phase 3 §23.2
 *
 * First concrete expression of v2 §14 "consultants and agronomists are core users."
 * Generates a PDF/CSV verification report filtered by template lineage,
 * usable as proof of advisory delivery.
 *
 * Visible only to: Agronomist | Consultant | PrimaryOwner.
 */

import React, { useState } from 'react';
import { useFarmContext } from '../../../core/session/FarmContext';
import ServiceProofFilterSheet from '../components/ServiceProofFilterSheet';
import { generateServiceProof, type ServiceProofParams } from '../data/serviceProofClient';
import type { AppRoute } from '../../../domain/types/farm.types';

interface ServiceProofPageProps {
    onNavigate?: (route: AppRoute) => void;
    onBack?: () => void;
}

interface RecentExport {
    url: string;
    format: string;
    generatedAt: string;
    fromDate: string;
    toDate: string;
}

const ServiceProofPage: React.FC<ServiceProofPageProps> = ({ onBack }) => {
    const { currentFarm } = useFarmContext();
    const [showFilterSheet, setShowFilterSheet] = useState(false);
    const [filterSummary, setFilterSummary] = useState<{
        templateLineageRootId?: string;
        fromDate: string;
        toDate: string;
        includeResolvedSignals: boolean;
    }>({
        fromDate: (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]; })(),
        toDate: new Date().toISOString().split('T')[0],
        includeResolvedSignals: false,
    });
    const [recentExports, setRecentExports] = useState<RecentExport[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const canAccess = currentFarm?.role === 'Agronomist' ||
        currentFarm?.role === 'Consultant' ||
        currentFarm?.role === 'PrimaryOwner';

    if (!canAccess) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
                <p style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }} className="text-base font-semibold text-stone-700">
                    ही सुविधा उपलब्ध नाही
                </p>
                <p style={{ fontFamily: "'DM Sans', sans-serif" }} className="text-sm text-stone-400 mt-1">
                    Service proof is available to Agronomist, Consultant, and Primary Owner only.
                </p>
            </div>
        );
    }

    const handleGenerate = async (format: 'ServiceProof' | 'Csv') => {
        setIsGenerating(true);
        setErrorMsg(null);

        const params: ServiceProofParams = {
            format,
            byTemplateLineageRootId: filterSummary.templateLineageRootId,
            fromDate: filterSummary.fromDate,
            toDate: filterSummary.toDate,
            includeResolvedSignals: filterSummary.includeResolvedSignals,
        };

        const result = await generateServiceProof(params);
        setIsGenerating(false);

        if (!result) {
            setErrorMsg('Could not generate export. Please check your connection.');
            return;
        }

        // Trigger download
        const a = document.createElement('a');
        a.href = result.url;
        a.download = `service-proof-${filterSummary.fromDate}-to-${filterSummary.toDate}.${format === 'Csv' ? 'csv' : 'pdf'}`;
        a.click();

        setRecentExports(prev => [{
            url: result.url,
            format,
            generatedAt: new Date().toISOString(),
            fromDate: filterSummary.fromDate,
            toDate: filterSummary.toDate,
        }, ...prev].slice(0, 5));
    };

    return (
        <div className="flex flex-col min-h-screen bg-stone-50 pb-24">
            {/* Header */}
            <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-stone-100 px-4 pt-safe-area">
                <div className="flex items-center gap-2 py-3">
                    {onBack && (
                        <button onClick={onBack} className="text-stone-500 p-1 -ml-1">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
                        </button>
                    )}
                    <div>
                        <h1 style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }} className="text-base font-bold text-stone-900">
                            सेवेचा पुरावा
                        </h1>
                        <p style={{ fontFamily: "'DM Sans', sans-serif" }} className="text-xs text-stone-500">
                            Service Proof Export
                        </p>
                    </div>
                </div>
            </div>

            <div className="flex-1 px-4 py-5 flex flex-col gap-5">
                {/* Intro banner */}
                <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4">
                    <p style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }} className="text-sm font-semibold text-emerald-800 leading-snug">
                        नियोजन, अंमलबजावणी आणि पडताळणी — सल्लागार नोंदीसाठी
                    </p>
                    <p style={{ fontFamily: "'DM Sans', sans-serif" }} className="text-xs text-emerald-700 mt-1">
                        Show what was planned, what was done, and what was verified — for your consulting record.
                    </p>
                </div>

                {/* Filter summary */}
                <div className="rounded-2xl bg-white border border-stone-200 p-4">
                    <div className="flex items-center justify-between mb-3">
                        <h3 style={{ fontFamily: "'DM Sans', sans-serif" }} className="text-sm font-bold text-stone-800">Filters</h3>
                        <button
                            onClick={() => setShowFilterSheet(true)}
                            className="text-xs font-semibold text-emerald-600"
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        >
                            Edit →
                        </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <span className="rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-600" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                            {filterSummary.fromDate} → {filterSummary.toDate}
                        </span>
                        {filterSummary.templateLineageRootId && (
                            <span className="rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-600" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                                Template: {filterSummary.templateLineageRootId.slice(0, 8)}…
                            </span>
                        )}
                        {filterSummary.includeResolvedSignals && (
                            <span className="rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs text-emerald-700" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                                + resolved signals
                            </span>
                        )}
                    </div>
                </div>

                {/* Error */}
                {errorMsg && (
                    <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-xs text-rose-700" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                        {errorMsg}
                    </div>
                )}

                {/* Generate buttons */}
                <div className="flex flex-col gap-3">
                    <button
                        onClick={() => handleGenerate('ServiceProof')}
                        disabled={isGenerating}
                        className="w-full rounded-2xl bg-stone-900 py-4 text-sm font-bold text-white disabled:opacity-60"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        {isGenerating ? 'Generating…' : '⬇ Generate PDF'}
                    </button>
                    <button
                        onClick={() => handleGenerate('Csv')}
                        disabled={isGenerating}
                        className="w-full rounded-2xl border border-stone-200 bg-white py-3.5 text-sm font-semibold text-stone-700 disabled:opacity-60"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        ⬇ Generate CSV
                    </button>
                </div>

                {/* Recent exports */}
                {recentExports.length > 0 && (
                    <div className="rounded-2xl bg-white border border-stone-200 p-4">
                        <h3 style={{ fontFamily: "'DM Sans', sans-serif" }} className="text-sm font-bold text-stone-800 mb-3">Recent exports</h3>
                        <div className="flex flex-col gap-2">
                            {recentExports.map((exp, i) => (
                                <a
                                    key={i}
                                    href={exp.url}
                                    download
                                    className="flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2"
                                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                                >
                                    <span className="text-xs text-stone-600">{exp.format} · {exp.fromDate} → {exp.toDate}</span>
                                    <span className="text-xs font-semibold text-emerald-600">↓</span>
                                </a>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Filter sheet */}
            {showFilterSheet && (
                <ServiceProofFilterSheet
                    onApply={params => {
                        setFilterSummary(params);
                        setShowFilterSheet(false);
                    }}
                    onClose={() => setShowFilterSheet(false)}
                />
            )}
        </div>
    );
};

export default ServiceProofPage;
