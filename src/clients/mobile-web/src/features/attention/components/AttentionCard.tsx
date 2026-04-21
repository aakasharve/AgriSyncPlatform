import React from 'react';
import AttentionRankPill from './AttentionRankPill';
import type { AttentionCardCacheRecord } from '../../../infrastructure/storage/DexieDatabase';

interface AttentionCardProps {
    card: AttentionCardCacheRecord;
    /**
     * Called when the suggested-action button is tapped. The parent
     * page decides how to route based on `card.suggestedAction`
     * (e.g. `AssignTest` → TestQueuePage). When omitted, the button
     * still renders but does nothing — useful for offline-safe stub
     * states.
     */
    onAction?: (card: AttentionCardCacheRecord) => void;
    /** CEI Phase 3 — open compliance signal count for this plot */
    openComplianceSignalCount?: number;
    /** Called when the compliance signal chip is tapped */
    onComplianceChipTap?: (plotId: string, farmId: string) => void;
}

const rankBorder: Record<string, string> = {
    Critical: 'border-rose-200 bg-white',
    NeedsAttention: 'border-amber-200 bg-white',
    Watch: 'border-stone-200 bg-white',
    Healthy: 'border-emerald-200 bg-white',
};

const AttentionCard: React.FC<AttentionCardProps> = ({ card, onAction, openComplianceSignalCount, onComplianceChipTap }) => {
    const border = rankBorder[card.rank] ?? 'border-stone-200 bg-white';

    return (
        <div className={`rounded-2xl border ${border} shadow-sm p-4 flex flex-col gap-3`}>
            {/* Header row */}
            <div className="flex items-start justify-between gap-2">
                <AttentionRankPill rank={card.rank} />
                <div className="flex items-center gap-2">
                    {/* CEI Phase 3 — compliance signal count chip */}
                    {openComplianceSignalCount != null && openComplianceSignalCount > 0 && (
                        <button
                            type="button"
                            onClick={() => onComplianceChipTap?.(card.plotId, card.farmId)}
                            className="inline-flex items-center gap-1 rounded-full bg-rose-100 border border-rose-200 px-2 py-0.5 text-[10px] font-semibold text-rose-700 active:bg-rose-200"
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        >
                            <span>⚠</span>
                            <span>{openComplianceSignalCount} signal{openComplianceSignalCount !== 1 ? 's' : ''}</span>
                        </button>
                    )}
                    <div className="text-right">
                        <p
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                            className="text-xs font-semibold text-stone-700 truncate max-w-[120px]"
                        >
                            {card.farmName}
                        </p>
                        <p
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                            className="text-xs text-stone-400"
                        >
                            {card.plotName}
                        </p>
                    </div>
                </div>
            </div>

            {/* Stage chip */}
            {card.stageName && (
                <span
                    className="self-start inline-block rounded-full bg-stone-100 px-2.5 py-0.5 text-xs text-stone-500"
                    style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                >
                    {card.stageName}
                </span>
            )}

            {/* Body */}
            <div>
                <p
                    style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                    className="text-sm font-semibold text-stone-800 leading-snug"
                >
                    {card.titleMr}
                </p>
                <p
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                    className="text-xs text-stone-400 mt-0.5"
                >
                    {card.titleEn}
                </p>
                <p
                    style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                    className="text-sm text-stone-600 mt-1.5 leading-relaxed"
                >
                    {card.descriptionMr}
                </p>
            </div>

            {/* Metric chips */}
            <div className="flex gap-2 flex-wrap">
                {card.overdueTaskCount != null && card.overdueTaskCount > 0 && (
                    <span
                        className="rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-xs text-amber-700"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        {card.overdueTaskCount} overdue
                    </span>
                )}
                {card.latestHealthScore && (
                    <span
                        className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs text-stone-600"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        {card.latestHealthScore}
                    </span>
                )}
            </div>

            {/* Primary action button */}
            <button
                type="button"
                className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white active:bg-emerald-700 transition-colors disabled:bg-stone-200 disabled:text-stone-400"
                style={{ fontFamily: "'DM Sans', sans-serif" }}
                onClick={() => onAction?.(card)}
                disabled={!onAction}
            >
                <span>{card.suggestedActionLabelMr}</span>
                <span className="text-emerald-200 ml-1 text-xs">{card.suggestedActionLabelEn}</span>
            </button>
        </div>
    );
};

export default AttentionCard;
