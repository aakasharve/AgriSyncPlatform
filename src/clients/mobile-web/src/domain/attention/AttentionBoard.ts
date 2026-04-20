// Mirror types for AttentionBoard domain
export interface AttentionCard {
    cardId: string;
    farmId: string;
    farmName: string;
    plotId: string;
    plotName: string;
    cropCycleId?: string | null;
    stageName?: string | null;
    rank: 'Critical' | 'NeedsAttention' | 'Watch' | 'Healthy';
    titleEn: string;
    titleMr: string;
    descriptionEn: string;
    descriptionMr: string;
    suggestedAction: string;
    suggestedActionLabelEn: string;
    suggestedActionLabelMr: string;
    overdueTaskCount?: number | null;
    latestHealthScore?: string | null;
    unresolvedDisputeCount?: number | null;
    computedAtUtc: string;
}

export interface AttentionBoard {
    asOfUtc: string;
    cards: AttentionCard[];
}
