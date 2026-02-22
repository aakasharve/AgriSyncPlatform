# HYBRID VOICE PIPELINE v1 — SPECIFICATION

**Date:** 2026-02-22
**Author:** Co-Founder Engineering Mode
**Predecessor:** `AI_ORCHESTRATION_SARVAM_PLAN_2026-02-22.md`
**Status:** Active — Must be implemented as Phase -1 BEFORE the AI orchestration plan.

---

## WHY THIS EXISTS

Cloud ASR (Sarvam Saaras v3 or Gemini) charges per second of raw audio.
Farmers speak freely: they rant, repeat, pause, go off-topic, speak dialect, and talk unstructured.
The product MUST feel unlimited — capping speech kills expression, trust, and habit.

But sending all raw audio to cloud creates an unpredictable cost curve that can kill before PMF.

**Design principle:** The farmer feels infinite. The system processes only signal.

---

## THE 4-LAYER ARCHITECTURE

```
┌──────────────────────────────────────────────┐
│  Layer 1: ON-DEVICE BUFFERING                │  Farmer speaks freely
│  Continuous recording, chunked buffer        │  No visible limits
├──────────────────────────────────────────────┤
│  Layer 2: SILENCE TRIMMING                   │  Remove dead air
│  VAD-based, runs in AudioWorklet             │  Saves 30-60% minutes
├──────────────────────────────────────────────┤
│  Layer 3: INTENT CHUNKING                    │  Split by topic
│  Pause-based segmentation (≥1.5s gap)        │  Better extraction
├──────────────────────────────────────────────┤
│  Layer 4: SEGMENT COMPRESSION                │  Reduce bitrate
│  Opus/WebM @ 16kHz mono 32kbps              │  Smaller uploads
└──────────────────────────────────────────────┘
          │
          ▼
    Backend receives: trimmed, chunked, compressed segments
    with per-segment metadata
```

---

## DEFINITIONS

### What counts as silence
- **Threshold:** RMS amplitude below `0.01` (normalized float range -1.0 to 1.0) for at least `500ms`
- **Padding:** Keep `150ms` of silence before and after speech to preserve natural phrasing
- **Detection method:** AudioWorklet frame-level RMS analysis (128-sample frames at 16kHz = 8ms per frame)
- **Leading silence:** Strip any silence at the start beyond 150ms
- **Trailing silence:** Strip any silence at the end beyond 300ms (users often trail off)

### How intents are chunked
- **Primary signal:** Silence gap ≥ `1500ms` (1.5 seconds) between speech segments
- **Minimum chunk duration:** `800ms` of speech content (anything shorter gets merged with next chunk)
- **Maximum chunk duration:** `120s` (2 minutes) — if farmer speaks continuously for >2min, force-split at next pause ≥ `500ms`
- **Merge rule:** If a chunk is < 800ms of speech, merge it with the preceding chunk (not following — preserves order)
- **No semantic analysis:** v1 uses pause-based splitting only, not NLP. The LLM handles multi-topic chunks.

### Maximum segments per session
- **Soft limit:** `20 segments` — after 20, warn user: "You can keep speaking, but consider saving what you have"
- **Hard limit:** `30 segments` — after 30, auto-finalize the session, process what exists
- **Total raw audio cap:** `10 minutes` of speech content (after silence removal)
- **Rationale:** 10 minutes of Marathi speech at normal pace = ~1500-2000 words = more than enough for any daily log

### Metadata per segment
```typescript
interface VoiceSegment {
    segmentIndex: number;           // 0-based order
    audioBlob: Blob;                // compressed audio (Opus/WebM)
    mimeType: string;               // 'audio/webm;codecs=opus'
    durationMs: number;             // speech duration after silence trim
    rawDurationMs: number;          // original duration before trim
    silenceRemovedMs: number;       // how much silence was trimmed
    contentHash: string;            // SHA-256 of audioBlob bytes
    startOffsetMs: number;          // offset from session start (for ordering)
    isFinal: boolean;               // true if user explicitly stopped
    sessionId: string;              // groups segments from one recording session
}

interface VoiceSessionMetadata {
    sessionId: string;              // UUID
    farmId: string;
    totalSegments: number;
    totalSpeechDurationMs: number;  // sum of all segment durations
    totalRawDurationMs: number;     // sum of all raw durations
    totalSilenceRemovedMs: number;  // total silence trimmed
    compressionRatio: number;       // compressed size / raw PCM size
    deviceTimestamp: string;        // ISO 8601
    clientTimezone: string;
}
```

### Idempotency key computation per segment
```
idempotencyKey = SHA-256(
    userId + "|" +
    farmId + "|" +
    sessionId + "|" +
    segmentIndex + "|" +
    contentHash
)
```
- Deterministic: same audio content always produces same key
- Scoped: per-user, per-farm, per-session, per-segment
- Safe for retry: re-uploading same segment hits idempotency cache

### Session-level idempotency
```
sessionIdempotencyKey = SHA-256(
    userId + "|" +
    farmId + "|" +
    sessionId + "|" +
    totalSegments + "|" +
    SHA-256(concat(segment[0].contentHash, ..., segment[N].contentHash))
)
```
- Used when all segments are sent as a single batch to the backend
- The orchestrator checks session-level key first, then per-segment if needed

---

## IMPLEMENTATION FILES

### New Files (Frontend — `src/clients/mobile-web/src/infrastructure/voice/`)

| # | File | Purpose |
|---|------|---------|
| 1 | `types.ts` | VoiceSegment, VoiceSessionMetadata, VoicePreprocessorConfig interfaces |
| 2 | `SilenceDetectorWorklet.ts` | AudioWorklet processor for real-time VAD |
| 3 | `SilenceTrimmer.ts` | Post-recording silence strip from PCM buffer |
| 4 | `IntentChunker.ts` | Splits trimmed audio into segments by pause gaps |
| 5 | `SegmentCompressor.ts` | Encodes PCM chunks to Opus/WebM via MediaRecorder |
| 6 | `VoicePreprocessor.ts` | Orchestrates Layer 1-4 pipeline |
| 7 | `ContentHasher.ts` | SHA-256 hash computation for audio blobs |

### Modified Files

| # | File | Change |
|---|------|--------|
| 1 | `src/infrastructure/ai/BackendAiClient.ts` | Accepts preprocessed segments instead of raw audio |
| 2 | `src/infrastructure/api/AgriSyncClient.ts` | Sends segment metadata with upload |

---

## BACKEND CHANGES (MINIMAL)

The backend AI orchestration plan already accepts audio streams. The only changes:

1. **`POST /shramsafal/ai/voice-parse`** accepts an additional optional field:
   - `segmentMetadata` (JSON string): serialized `VoiceSessionMetadata`
   - If present, the orchestrator stores it with the AiJob for cost tracking

2. **`AiJob` entity** gets two new fields:
   - `InputSpeechDurationMs` (int?) — actual speech duration for cost estimation
   - `InputRawDurationMs` (int?) — original recording duration before trimming

3. **`AiJobAttempt`** gets one new field:
   - `EstimatedCostUnits` (decimal?) — provider-specific cost estimation (e.g., Sarvam bills per 10s)

---

## COST GOVERNANCE

### Estimated costs (Sarvam Saaras v3)
- Billed per 10-second increment
- Without trimming: 5-min farmer session = 30 units
- With trimming (typical 40% silence): 3-min speech = 18 units = **40% savings**
- With compression: no direct cost savings (ASR billed on duration, not file size) but faster upload

### Cost tracking per job
```sql
-- New columns on ai_jobs table
ALTER TABLE ssf.ai_jobs ADD COLUMN input_speech_duration_ms int;
ALTER TABLE ssf.ai_jobs ADD COLUMN input_raw_duration_ms int;

-- New column on ai_job_attempts table
ALTER TABLE ssf.ai_job_attempts ADD COLUMN estimated_cost_units decimal(10,4);
```

### Dashboard metrics (added to Phase 10)
- Total speech minutes processed (daily/weekly/monthly)
- Total silence minutes saved
- Estimated cost savings from trimming
- Cost per successful parse (average)
- Cost per provider comparison

---

## SCHEMA VERSIONING

Every normalized AI output stored in `AiJob.NormalizedResultJson` must include:
```json
{
    "_meta": {
        "schemaVersion": "1.0.0",
        "pipelineVersion": "hybrid-v1",
        "promptVersion": "2026-02-22"
    },
    // ... rest of AgriLogResponse
}
```

This allows future schema changes to know how to interpret old stored outputs.

---

## LATENCY GUARDRAILS

| Step | Timeout | Action on timeout |
|------|---------|-------------------|
| Silence trimming (on-device) | 2s per minute of audio | Skip trimming, send raw |
| Segment compression (on-device) | 3s per segment | Skip compression, send PCM |
| Sarvam STT | 15s per segment | Trigger Gemini fallback |
| Sarvam Chat (reasoning) | 20s | Trigger Gemini fallback |
| Gemini multimodal | 30s | Return error to user |
| Total end-to-end | 60s from upload | Return partial result or error |

---

## INPUT SIZE VALIDATION

| Check | Limit | Action |
|-------|-------|--------|
| Audio file size per segment | 10 MB | Reject with 413 |
| Total session audio size | 50 MB | Reject with 413 |
| Image file size (receipt/patti) | 15 MB | Reject with 413 |
| Audio duration per segment (claimed) | 120s | Reject with 422 |
| Total session speech duration | 600s (10 min) | Reject with 422 |
| Number of segments per session | 30 | Reject with 422 |
| Minimum audio duration | 500ms | Reject with 422 ("too short") |

---

## DETERMINISTIC FINANCIAL POST-PROCESSING

The LLM proposes financial values. Backend code finalizes:

1. **Labour costs:** `totalCost = count × wagePerPerson` — recalculated in C#, LLM value ignored
2. **Input costs:** `totalCost = Σ(item.qty × item.unitPrice)` — recalculated
3. **Expense totals:** `totalAmount = Σ(items[].total)` — recalculated
4. **Irrigation volume:** `volume = flowRate × durationHours` — recalculated from plot infrastructure
5. **Contract labour:** `totalCost = contractQuantity × rate` — recalculated

The `AiResponseNormalizer` on the backend runs these calculations AFTER the LLM returns and BEFORE storing as `NormalizedResultJson`. The LLM's proposed values are preserved in `RawProviderResponse` for audit.

---

## GOLDEN DATASET BENCHMARKING

Before Sarvam becomes production default:

1. Collect 50 real Marathi rural audio clips (diverse: male/female, young/old, different regions)
2. Collect 20 receipt images (handwritten + printed, different markets)
3. Collect 10 patti images (different formats)
4. Run each through both Sarvam and Gemini pipelines
5. Score on:
   - Transcript accuracy (WER for STT)
   - Structured extraction accuracy (field-level F1)
   - Latency (p50, p95, p99)
   - Cost per operation
6. Decision: provider with better F1 AND acceptable latency becomes default
7. Store benchmark results in `_COFOUNDER/02_Quality/golden_dataset_results/`

---

## CIRCUIT BREAKER FUTURE NOTE

v1: In-memory `Dictionary<AiProviderType, CircuitBreaker>` — resets on app restart.
v2 (when running multiple instances behind load balancer): Move circuit breaker state to Redis.
- Key: `ai:circuit:{providerType}`
- Value: `{ state, failureCount, lastFailureUtc, lastSuccessUtc }`
- TTL: matches `CircuitBreakerResetSeconds` from config
- Use `WATCH` + `MULTI` for atomic state transitions

---

## PHASE GATE

Phase -1 is complete when:
- [ ] `SilenceDetectorWorklet.ts` correctly identifies speech vs silence in test audio
- [ ] `SilenceTrimmer.ts` removes ≥30% of duration from a test clip with known pauses
- [ ] `IntentChunker.ts` produces correct segment count for test audio with known pause patterns
- [ ] `SegmentCompressor.ts` produces valid Opus/WebM output
- [ ] `VoicePreprocessor.ts` orchestrates all 4 layers end-to-end
- [ ] `ContentHasher.ts` produces deterministic SHA-256 for same input
- [ ] Segment metadata is correctly formed and serializable
- [ ] Idempotency key is deterministic for same content
- [ ] Frontend builds with zero TypeScript errors
- [ ] No regressions in existing voice recording flow
