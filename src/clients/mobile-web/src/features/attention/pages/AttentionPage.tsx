import React from 'react';
import { useAttentionBoard } from '../hooks/useAttentionBoard';
import AttentionCard from '../components/AttentionCard';

const AttentionPage: React.FC = () => {
    const { cards, asOf, isLoading } = useAttentionBoard();

    const critical = cards.filter(c => c.rank === 'Critical');
    const needsAttention = cards.filter(c => c.rank === 'NeedsAttention');
    const watch = cards.filter(c => c.rank === 'Watch');

    if (isLoading && cards.length === 0) {
        return (
            <div className="flex h-full items-center justify-center">
                <p style={{ fontFamily: "'DM Sans', sans-serif" }} className="text-stone-400 text-sm">
                    Loading...
                </p>
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
            </div>
        );
    }

    const asOfLabel = asOf
        ? new Date(asOf).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
        : '';

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
                                <AttentionCard key={card.cardId} card={card} />
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
                                <AttentionCard key={card.cardId} card={card} />
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
                                <AttentionCard key={card.cardId} card={card} />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AttentionPage;
