/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14 — H14, H16) — one server board card in the app's
 * common look (a glass card with a coloured edge, PLR-D9 preview `app/PlacePages.tsx`), Marathi only: the
 * server's `titleMr` / `descriptionMr` / `suggestedActionLabelMr` (the English twin lines are gone — no
 * doubled labels). The button is drawn ONLY when the page gives it somewhere to go (`onAction`); a card
 * whose action has no place in the app shows no button (P5) instead of a button that does nothing.
 */
import React from 'react';
import { TriangleAlert } from 'lucide-react';
import AttentionRankPill from './AttentionRankPill';
import type { AttentionCardCacheRecord } from '../../../infrastructure/storage/DexieDatabase';
import { GlassCard, IconDot, Tap, type Tone } from '../../../shared/components/ui/placeUi';
import { stageNameMr } from '../../../shared/utils/stageNameMr';
import { toDevanagariDigits } from '../../../shared/utils/marathiDigits';
import { attentionRankOf, type AttentionRankName } from '../attentionWire';

interface AttentionCardProps {
    card: AttentionCardCacheRecord;
    /** Follow the card's button. Omit when the action has nowhere to go: no button is drawn. */
    onAction?: (card: AttentionCardCacheRecord) => void;
    /**
     * The button's words (`attentionButtonLabelMr`: names where it goes). Defaults to the server's
     * `suggestedActionLabelMr`; empty → no button.
     */
    actionLabel?: string | null;
    /** CEI Phase 3 — open compliance signal count for this plot */
    openComplianceSignalCount?: number;
    /** Called when the compliance signal chip is tapped */
    onComplianceChipTap?: (plotId: string, farmId: string) => void;
}

// The rank arrives as the server's ordinal number (`attentionWire.ts`). A rank we cannot read gets a plain
// edge, never another band's colour.
const RANK_EDGE: Record<AttentionRankName, { edge: string; tone: Tone }> = {
    Critical: { edge: 'border-l-rose-500', tone: 'rose' },
    NeedsAttention: { edge: 'border-l-amber-500', tone: 'amber' },
    Watch: { edge: 'border-l-blue-500', tone: 'blue' },
    Healthy: { edge: 'border-l-emerald-500', tone: 'green' },
};
const UNKNOWN_EDGE: { edge: string; tone: Tone } = { edge: 'border-l-stone-300', tone: 'stone' };

// The server's health score names (`HealthScore.cs`), in Marathi. PROPOSED (Marathi)
const HEALTH_MR: Record<string, string> = {
    Excellent: 'तब्येत: उत्तम',
    Good: 'तब्येत: चांगली',
    NeedsAttention: 'तब्येत: लक्ष द्या',
    Critical: 'तब्येत: गंभीर',
};

const AttentionCard: React.FC<AttentionCardProps> = ({ card, onAction, actionLabel, openComplianceSignalCount, onComplianceChipTap }) => {
    const buttonLabel = actionLabel === undefined ? card.suggestedActionLabelMr : actionLabel;
    const rankName = attentionRankOf(card.rank);
    const rank = rankName ? RANK_EDGE[rankName] : UNKNOWN_EDGE;
    const health = card.latestHealthScore ? HEALTH_MR[card.latestHealthScore] : undefined;
    const place = [card.farmName, card.plotName].filter(Boolean).join(' · ');
    // The server's stage is raw `CropCycle.Stage` (English template name, or "unstated" / "Unknown"):
    // said in Marathi, or not shown at all.
    const stage = stageNameMr(card.stageName);

    return (
        <GlassCard className={`border-l-4 ${rank.edge}`} testId={`attention-card-${card.cardId}`}>
            <div className="flex items-start gap-3">
                <IconDot tone={rank.tone}><TriangleAlert size={22} aria-hidden="true" /></IconDot>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <AttentionRankPill rank={card.rank} />
                        {stage && <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-[12.5px] font-bold text-stone-600" data-testid="attention-stage">{stage}</span>}
                    </div>
                    <p className="m-0 mt-1.5 text-[16px] font-extrabold leading-snug text-stone-900">{card.titleMr}</p>
                    {card.descriptionMr && <p className="m-0 mt-0.5 text-[13.5px] font-semibold leading-snug text-stone-600">{card.descriptionMr}</p>}
                    {place && <p className="m-0 mt-1 text-[12.5px] font-bold text-stone-500">{place}</p>}
                </div>
            </div>

            {(health || (card.overdueTaskCount != null && card.overdueTaskCount > 0) || (openComplianceSignalCount != null && openComplianceSignalCount > 0)) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {card.overdueTaskCount != null && card.overdueTaskCount > 0 && (
                        // PROPOSED (Marathi) — was "{n} overdue"
                        <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[12.5px] font-bold text-amber-800 ring-1 ring-amber-200">{toDevanagariDigits(card.overdueTaskCount)} कामं बाकी</span>
                    )}
                    {health && <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-[12.5px] font-bold text-stone-700">{health}</span>}
                    {openComplianceSignalCount != null && openComplianceSignalCount > 0 && onComplianceChipTap && (
                        <Tap onClick={() => onComplianceChipTap(card.plotId, card.farmId)}
                            className="rounded-full bg-rose-100 px-2.5 py-0.5 text-[12.5px] font-bold text-rose-800 ring-1 ring-rose-200">
                            {/* "चेतावण्या" = the app's own word for these (ComplianceSignalsPage title) */}
                            ⚠ {toDevanagariDigits(openComplianceSignalCount)} चेतावण्या
                        </Tap>
                    )}
                </div>
            )}

            {onAction && buttonLabel && (
                <Tap onClick={() => onAction(card)} data-testid={`attention-go-${card.cardId}`}
                    className="mt-3 flex min-h-[46px] w-full items-center justify-center rounded-full border-2 border-emerald-600 bg-white text-[15px] font-extrabold text-emerald-800">
                    {buttonLabel}
                </Tap>
            )}
        </GlassCard>
    );
};

export default AttentionCard;
