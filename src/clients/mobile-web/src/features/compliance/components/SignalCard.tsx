import React, { useState } from 'react';
import SeverityPill from './SeverityPill';
import type { ComplianceSignalDto } from '../data/complianceClient';
import { acknowledgeSignal, resolveSignal } from '../data/complianceClient';
import type { AppRoute } from '../../../domain/types/farm.types';

interface SignalCardProps {
    signal: ComplianceSignalDto;
    onNavigate?: (route: AppRoute) => void;
    onMutated: () => void;
}

const formatRelative = (iso: string): string => {
    const ms = Date.now() - new Date(iso).getTime();
    const days = Math.floor(ms / 86_400_000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return `${days}d ago`;
};

const SignalCard: React.FC<SignalCardProps> = ({ signal, onNavigate, onMutated }) => {
    const [resolveNote, setResolveNote] = useState('');
    const [showResolve, setShowResolve] = useState(false);
    const [busy, setBusy] = useState(false);

    const suggestedRoute = (): AppRoute | null => {
        switch (signal.suggestedAction) {
            case 'OpenPlot': return 'main';
            case 'OpenStageCompare': return 'attention';
            case 'AssignTest': return 'tests';
            case 'ScheduleMissingActivity': return 'schedule';
            case 'ResolveDispute': return 'attention';
            default: return null;
        }
    };

    const handleAcknowledge = async () => {
        setBusy(true);
        await acknowledgeSignal(signal.id);
        onMutated();
        setBusy(false);
    };

    const handleResolve = async () => {
        if (resolveNote.trim().length < 3) return;
        setBusy(true);
        await resolveSignal(signal.id, resolveNote.trim());
        onMutated();
        setBusy(false);
    };

    const route = suggestedRoute();

    return (
        <div className="rounded-2xl border border-stone-200 bg-white shadow-sm p-4 flex flex-col gap-3">
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
                <SeverityPill severity={signal.severity} />
                <span
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                    className="text-[9px] text-stone-400 text-right break-all max-w-[160px]"
                >
                    {signal.ruleCode}
                </span>
            </div>

            {/* Title */}
            <div>
                <p style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }} className="text-sm font-semibold text-stone-800 leading-snug">
                    {signal.titleMr}
                </p>
                <p style={{ fontFamily: "'DM Sans', sans-serif" }} className="text-xs text-stone-500">
                    {signal.titleEn}
                </p>
            </div>

            {/* Description */}
            <div>
                <p style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }} className="text-xs text-stone-700 leading-relaxed">
                    {signal.descriptionMr}
                </p>
                <p style={{ fontFamily: "'DM Sans', sans-serif" }} className="text-xs text-stone-400 mt-0.5">
                    {signal.descriptionEn}
                </p>
            </div>

            {/* Timestamps */}
            <div className="flex justify-between items-center text-[10px] text-stone-400" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                <span>First: {formatRelative(signal.firstSeenAtUtc)}</span>
                {signal.lastSeenAtUtc !== signal.firstSeenAtUtc && (
                    <span>Last: {formatRelative(signal.lastSeenAtUtc)}</span>
                )}
            </div>

            {/* Resolve input */}
            {showResolve && (
                <div className="flex flex-col gap-2">
                    <textarea
                        className="w-full rounded-lg border border-stone-200 p-2 text-xs resize-none"
                        style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                        rows={2}
                        placeholder="काय केले? (किमान 3 अक्षरे)"
                        value={resolveNote}
                        onChange={e => setResolveNote(e.target.value)}
                    />
                    <div className="flex gap-2">
                        <button
                            onClick={handleResolve}
                            disabled={busy || resolveNote.trim().length < 3}
                            className="flex-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                        >
                            Resolve
                        </button>
                        <button
                            onClick={() => setShowResolve(false)}
                            className="px-3 py-1.5 text-xs text-stone-500"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Actions */}
            {!showResolve && signal.isOpen && (
                <div className="flex items-center gap-2 flex-wrap">
                    {route && (
                        <button
                            onClick={() => onNavigate?.(route)}
                            className="flex-1 rounded-lg bg-stone-800 px-3 py-2 text-xs font-semibold text-white"
                        >
                            {signal.suggestedAction.replace(/([A-Z])/g, ' $1').trim()}
                        </button>
                    )}
                    <button
                        onClick={handleAcknowledge}
                        disabled={busy}
                        className="rounded-lg border border-stone-200 px-3 py-2 text-xs font-medium text-stone-600 disabled:opacity-50"
                    >
                        Seen
                    </button>
                    <button
                        onClick={() => setShowResolve(true)}
                        className="rounded-lg border border-stone-200 px-3 py-2 text-xs font-medium text-stone-600"
                    >
                        ✓ Done
                    </button>
                </div>
            )}
        </div>
    );
};

export default SignalCard;
