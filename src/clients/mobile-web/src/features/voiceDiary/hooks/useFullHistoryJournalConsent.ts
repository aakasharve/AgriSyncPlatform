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

import { useCallback, useEffect, useRef, useState } from 'react';
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import { ConsentState } from '../../../domain/consent/ConsentState';
import { observeArchiveConsentView } from '../../../infrastructure/voice/voiceArchiveConsent';
import { publishPlaybackSwitch } from '../../logs/components/voiceResult/playbackSwitch';

export interface UseFullHistoryJournalConsentResult {
    granted: boolean;
    loaded: boolean;
    /** True once the server has answered at least once: only then is `granted` an answer rather than the default (OFF). */
    known: boolean;
    state: ConsentState;
    /** Re-fetch the consent state from the server. */
    reload: () => Promise<void>;
}

export function useFullHistoryJournalConsent(): UseFullHistoryJournalConsentResult {
    const [state, setState] = useState<ConsentState>(() => ConsentState.default());
    const [loaded, setLoaded] = useState(false);
    const [known, setKnown] = useState(false);
    const knownRef = useRef(false);

    const reload = useCallback(async () => {
        try {
            const dto = await agriSyncClient.getConsent();
            // Keep the upload boundary (max of this phone and the server's grant start)
            // current, so the diary labels use the same bound as the uploader.
            await observeArchiveConsentView(dto).catch(() => null);
            knownRef.current = true;
            setKnown(true);
            publishPlaybackSwitch(dto.fullHistoryJournal === true); // every other player on the phone follows this answer at once
            setState({
                fullHistoryJournal: dto.fullHistoryJournal,
                crossFarmAggregation: dto.crossFarmAggregation,
                researchCorpusExport: dto.researchCorpusExport,
                version: dto.version,
                acceptedAtUtc: dto.acceptedAtUtc,
                revokedAtUtc: dto.revokedAtUtc,
            });
        } catch {
            // No prior consent or endpoint unavailable — default to false. A later
            // RE-read that fails (phone offline) keeps the last answer the server gave.
            if (!knownRef.current) setState(ConsentState.default());
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
        known,
        state,
        reload,
    };
}
