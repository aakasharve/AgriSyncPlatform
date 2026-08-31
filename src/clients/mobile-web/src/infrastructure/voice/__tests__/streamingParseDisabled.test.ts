/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GUARD. `useStreamingParse` must stay OFF until the streaming path creates an
 * AiJob. This is not a preference — turning it on silently breaks DFES scoring
 * for every farmer, and it did so in production from June to 2026-08-31.
 *
 * MEASURED IN PROD (2026-08-31, RLS-bypassing read):
 *   daily_logs = 145, richness_aggregates = 3, ai_jobs = 91 (none since 13 June)
 *   logs carrying source_ai_job_id = 0 of 145
 *   application_input_items = 0, irrigation_entries = 0, observation_events = 0
 *   scorer on 2026-08-30: WHAT coverage 0, COST 0, OBS 0  =>  0/10
 *
 * THE CHAIN. `AiOrchestrator.ParseVoiceWithFallbackAsync` and
 * `ParseVoiceTwoStageAsync` each return `(Result, Guid JobId, ...)`.
 * `ParseVoiceStreamAsync` returns no job id and creates no AiJob at all. So with
 * streaming on:
 *   1. no AiJob row exists for the parse;
 *   2. `useVoiceRecorder` builds provenance as `source:'ai'` with NO sourceAiJobId;
 *   3. `CreateDailyLogHandler` derives the typed ledger only when SourceAiJobId is
 *      present — branch skipped;
 *   4. the ManualDraft fallback ships only on a positive `source:'manual'`
 *      assertion, and a voice log is 'ai' — also skipped;
 *   5. nothing is derived, so DfesLensExtractor scores an empty day: 0/10.
 *
 * With it OFF, `canRunLiveCaption` (useVoiceRecorder.ts:424) is false, the batch
 * path runs, `/ai/voice-parse` returns `sourceAiJobId = job?.Id`
 * (AiEndpoints.cs:669), `BackendAiClient.ts:121` stamps it, and the whole chain
 * reconnects.
 *
 * Turning this back on REQUIRES the streaming path to create an AiJob and emit
 * its id on the terminal `complete` event. Until that exists, this guard stands.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_VOICE_CONFIG } from '../types';

describe('DEFAULT_VOICE_CONFIG.useStreamingParse', () => {
    it('is OFF, because the streaming path creates no AiJob and that zeroes DFES scoring', () => {
        expect(DEFAULT_VOICE_CONFIG.useStreamingParse).toBe(false);
    });
});
