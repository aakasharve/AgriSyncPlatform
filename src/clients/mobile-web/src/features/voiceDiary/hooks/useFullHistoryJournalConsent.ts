// spec: voice-diary-e2e-2026-05-17 (D.6, D.10, D.11)
//
// Shared hook — returns the current value of `FullHistoryJournal` from
// the server-side ConsentState plus an action to refresh it. Used by
// RetentionBanner, EmptyStatePrompt, VoiceDiaryPage, and the consent
// toggle ack flow.
//
// Per envelope brief: this hook DOES NOT introduce a new consent surface
// — it consumes the existing `agriSyncClient.getConsent` shape that
// Phase 06.4 (consent feature) already established. The hook caches the
// result in component state; the source of truth remains the server.

import { useCallback, useEffect, useState } from 'react';
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import { ConsentState } from '../../../domain/consent/ConsentState';

export interface UseFullHistoryJournalConsentResult {
    granted: boolean;
    loaded: boolean;
    state: ConsentState;
    /** Re-fetch the consent state from the server. */
    reload: () => Promise<void>;
}

export function useFullHistoryJournalConsent(): UseFullHistoryJournalConsentResult {
    const [state, setState] = useState<ConsentState>(() => ConsentState.default());
    const [loaded, setLoaded] = useState(false);

    const reload = useCallback(async () => {
        try {
            const dto = await agriSyncClient.getConsent();
            setState({
                fullHistoryJournal: dto.fullHistoryJournal,
                crossFarmAggregation: dto.crossFarmAggregation,
                researchCorpusExport: dto.researchCorpusExport,
                version: dto.version,
                acceptedAtUtc: dto.acceptedAtUtc,
                revokedAtUtc: dto.revokedAtUtc,
            });
        } catch {
            // No prior consent or endpoint unavailable — default to false.
            setState(ConsentState.default());
        } finally {
            setLoaded(true);
        }
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    return {
        granted: state.fullHistoryJournal,
        loaded,
        state,
        reload,
    };
}
