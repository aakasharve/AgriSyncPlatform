import React, { useCallback } from 'react';
import { useAttentionBoard } from '../hooks/useAttentionBoard';
import AttentionCard from '../components/AttentionCard';
import { useAppNavigationState } from '../../../app/context/AppFeatureContexts';
import type { AttentionCardCacheRecord } from '../../../infrastructure/storage/DexieDatabase';
import { formatDisplayTime } from '../../../shared/utils/displayTime';
// TASK 8 — reused as-is, no new copy. See the note in `JobCardsPage.tsx`.
import { LoadErrorBanner } from '../../labour/components/LabourUiKit';

const AttentionPage: React.FC = () => {
    const { cards, asOf, isLoading, loadFailed, refresh } = useAttentionBoard();
    const { setCurrentRoute } = useAppNavigationState();

    /**
     * Route attention-card actions. CEI Phase 2 §4.5 task 4.3.1 —
     * the `AssignTest` suggested action must deep-link to the test
     * queue with a plot filter so the owner lands directly on the
     * card they need to action, not a generic list.
     */
    const handleCardAction = useCallback((card: AttentionCardCacheRecord) => {
        const action = card.suggestedAction;
        if (action === 'AssignTest') {
            if (typeof window !== 'undefined') {
                const params = new URLSearchParams();
                params.set('filter', 'Due');
                if (card.plotId) params.set('plotId', card.plotId);
                if (card.cropCycleId) params.set('cropCycleId', card.cropCycleId);
                window.history.pushState({}, '', `/tests?${params.toString()}`);
            }
            setCurrentRoute('tests');
            return;
        }
        // Other suggested actions (OpenReviewInbox, ReviewHealth, etc.)
        // will be wired in follow-up tasks as the corresponding pages
        // land. For now we no-op so farmers aren't routed into dead
        // screens.
    }, [setCurrentRoute]);

    const critical = cards.filter(c => c.rank === 'Critical');
    const needsAttention = cards.filter(c => c.rank === 'NeedsAttention');
    const watch = cards.filter(c => c.rank === 'Watch');

    // TASK 8b — computed once, above every return, so both the card-list
    // branch and the all-clear branch below can render the same "as of
    // <time>" stamp instead of each having its own copy of this logic.
    const asOfLabel = asOf
        ? formatDisplayTime(asOf)
        : '';

    if (isLoading && cards.length === 0) {
        return (
            <div className="flex h-full items-center justify-center">
                <p style={{ fontFamily: "'DM Sans', sans-serif" }} className="text-stone-400 text-sm">
                    Loading...
                </p>
            </div>
        );
    }

    /*
     * TASK 8 (spec: 2026-08-28-labour-v2-release-1, P4/P5, Ruling R8) — the
     * worst of the four sites, because this screen is on the bottom nav and
     * because the sentence below is a REASSURANCE, not a count.
     *
     * `db.attentionCards` is filled by exactly one thing: a SUCCESSFUL sync
     * pull. On a device whose sync has never succeeded — a fresh install on
     * weak rural signal, the pilot's ordinary first hour — the table is empty
     * for the same reason a blank page is blank, and the branch below read
     * that as an answer and told the farmer his farms were fine. A farmer who
     * is told that does not go and look.
     *
     * This gate is on `loadFailed` (no sync cursor: nothing has ever
     * populated the board) and NEVER on `cards.length`. Once a pull HAS
     * landed, zero cards is a real answer and the all-clear below is true —
     * it still renders, unchanged, which is what stops this fix from
     * replacing one falsehood with its opposite.
     */
    if (loadFailed) {
        return (
            <div className="flex h-full flex-col items-center justify-center px-4">
                <LoadErrorBanner onRetry={refresh} compact />
            </div>
        );
    }

    if (cards.length === 0) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-8">
                <div className="text-4xl">🌱</div>
                <p
                    style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                    className="text-center text-base font-medium text-stone-600"
                >
                    सगळ्या शेती आज व्यवस्थित आहेत
                </p>
                <p
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                    className="text-center text-sm text-stone-400"
                >
                    All your farms are on track today
                </p>
                {/*
                 * TASK 8b — this all-clear was previously a bare claim of
                 * "today" even when `cards` reflects the last sync that
                 * SUCCEEDED, not necessarily today's. The same "as of <time>"
                 * stamp the card-list branch below already renders makes the
                 * sentence true regardless of which day it is from: reused
                 * verbatim, not new copy. When `asOf` cannot be known (see
                 * `useAttentionBoard`), `asOfLabel` is empty and this simply
                 * does not render — the bare sentence stays unqualified
                 * rather than showing an invented time.
                 */}
                {asOfLabel && (
                    <span
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                        className="text-xs text-stone-400"
                    >
                        as of {asOfLabel}
                    </span>
                )}
            </div>
        );
    }

    return (
        <div className="flex flex-col min-h-full bg-stone-50">
            {/* Header */}
            <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-md border-b border-stone-100 px-4 py-3">
                <div className="flex items-baseline justify-between">
                    <h1
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                        className="text-xl font-bold text-stone-800"
                    >
                        Attention
                    </h1>
                    {asOfLabel && (
                        <span
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                            className="text-xs text-stone-400"
                        >
                            as of {asOfLabel}
                        </span>
                    )}
                </div>
                <p
                    style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                    className="text-sm text-stone-500 mt-0.5"
                >
                    लक्ष द्या
                </p>
            </div>

            <div className="flex flex-col gap-4 px-4 py-4 pb-24">
                {/* Critical band */}
                {critical.length > 0 && (
                    <div>
                        <h2
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                            className="text-xs font-bold uppercase tracking-wide text-rose-600 mb-2"
                        >
                            Critical
                        </h2>
                        <div className="flex flex-col gap-3">
                            {critical.map(card => (
                                <AttentionCard key={card.cardId} card={card} onAction={handleCardAction} />
                            ))}
                        </div>
                    </div>
                )}

                {/* Needs Attention band */}
                {needsAttention.length > 0 && (
                    <div>
                        <h2
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                            className="text-xs font-bold uppercase tracking-wide text-amber-600 mb-2"
                        >
                            Needs Attention
                        </h2>
                        <div className="flex flex-col gap-3">
                            {needsAttention.map(card => (
                                <AttentionCard key={card.cardId} card={card} onAction={handleCardAction} />
                            ))}
                        </div>
                    </div>
                )}

                {/* Watch band */}
                {watch.length > 0 && (
                    <div>
                        <h2
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                            className="text-xs font-bold uppercase tracking-wide text-stone-500 mb-2"
                        >
                            Watch
                        </h2>
                        <div className="flex flex-col gap-3">
                            {watch.map(card => (
                                <AttentionCard key={card.cardId} card={card} onAction={handleCardAction} />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AttentionPage;
