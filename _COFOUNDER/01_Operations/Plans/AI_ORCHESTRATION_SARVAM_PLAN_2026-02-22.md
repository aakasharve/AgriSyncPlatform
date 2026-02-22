# AI ORCHESTRATION LAYER: SARVAM-DEFAULT, GEMINI-FALLBACK

**Date:** 2026-02-22
**Author:** Co-Founder Engineering Mode
**Predecessor Plans:**
- `CAPACITOR_TRUST_LEDGER_PLAN_2026-02-22.md` (Phases 0-7)
- `PHASE7_UI_ALIGNMENT_SPEC_2026-02-22.md` (frontend queue alignment)
**Verdict:** AI processing currently lives entirely in the browser (Gemini API called from React). This creates three critical problems: (1) API keys are exposed client-side, (2) no audit trail for AI decisions, (3) no provider flexibility. This plan moves ALL AI processing server-side behind a provider-agnostic orchestration layer, defaults to Sarvam for Indian language superiority, and falls back to Gemini on failure -- without breaking a single farmer flow.

**CRITICAL ADDITION (2026-02-22):** This plan now includes Phase -1 (Hybrid Voice Preprocessing) which MUST be implemented before Phase 0. See `HYBRID_VOICE_PIPELINE_V1_SPEC_2026-02-22.md` for full spec. The 4-layer voice preprocessing (buffering, silence trim, intent chunking, compression) controls cloud ASR costs while preserving unlimited-feeling voice input.

**7 READINESS ADDITIONS (integrated into relevant phases):**
1. **Cost governance fields** — `EstimatedCostUnits` on AiJobAttempt, `InputSpeechDurationMs`/`InputRawDurationMs` on AiJob (Phase 0, 3)
2. **Schema versioning** — `_meta.schemaVersion` in every NormalizedResultJson output (Phase 4, 5)
3. **Deterministic financial post-processing** — LLM proposes, C# code finalizes totals (Phase 4 AiResponseNormalizer)
4. **Latency guardrails** — Per-step timeouts with automatic fallback triggers (Phase 5, 6)
5. **Golden dataset benchmarking** — 50 audio + 20 receipt + 10 patti test set before production default (Phase 9)
6. **Circuit breaker Redis note** — v1 in-memory, v2 Redis when multi-instance (Phase 6 doc)
7. **Input size validation** — Reject oversized audio/images before hitting providers (Phase 7 endpoint validation)

---

## HOW TO USE THIS DOCUMENT

**Before starting work:** Read Phases 0 through 10 in order. Each phase has prerequisites. Do not skip.
**During work:** Check off subtasks as `[x]` when complete. Each phase has a GATE -- a single command or test that proves the phase is done.
**After completion:** Every `[ ]` in this document must be `[x]`. The DEFINITION OF DONE section at the bottom is the final audit.

**Rule for the developer agent:** If a subtask says "File: X" -- that is the EXACT file path. Do not create files at other paths. Do not rename folders. Do not create new projects unless explicitly stated. If a file path does not exist yet, it means CREATE it at that exact path. If it exists, MODIFY it as described.

---

## GROUND TRUTH: CURRENT STATE (Verified 2026-02-22)

### Where AI Lives Today (THE PROBLEM)

| Component | Location | Provider | Problem |
|---|---|---|---|
| Voice Parsing (audio -> structured log) | `src/clients/mobile-web/src/infrastructure/ai/GeminiClient.ts` | Gemini 2.0 Flash (browser) | API key in `VITE_GEMINI_API_KEY` env var, exposed to client |
| Receipt OCR (image -> expense items) | `src/clients/mobile-web/src/services/receiptExtractionService.ts` | Gemini 2.0 Flash (browser) | Same key exposure, no audit |
| Patti Image Parsing (image -> sale data) | `src/clients/mobile-web/src/services/pattiImageService.ts` | Gemini 2.0 Flash (browser) | Same key exposure, no audit |
| Vocab Learning (transcript -> new terms) | `src/clients/mobile-web/src/services/vocabLearner.ts` | Gemini 2.0 Flash (browser) | Direct REST call with key in URL |
| AI Prompt Builder | `src/clients/mobile-web/src/services/aiPrompts.ts` | N/A (generates system prompt) | ~700-line prompt, battle-tested |
| AI Response Normalizer | `src/clients/mobile-web/src/infrastructure/ai/AIResponseNormalizer.ts` | N/A (post-processing) | Fills defaults, generates IDs |
| AI Contract Gate | `src/clients/mobile-web/src/application/services/AiContractGate.ts` | N/A (validation) | Strict schema enforcement |
| Confidence Assessor | `src/clients/mobile-web/src/domain/ai/ConfidenceAssessor.ts` | N/A (scoring) | Per-field confidence |
| AgriLog Response Schema | `src/clients/mobile-web/src/domain/ai/contracts/AgriLogResponseSchema.ts` | N/A (Zod schema) | 385-line strict contract |

### Frontend AI Port Interface (The Boundary We Preserve)

```typescript
// File: src/clients/mobile-web/src/application/ports/index.ts
export interface VoiceParserPort {
    parseInput(input: VoiceInput, context: LogScope, crops: CropProfile[],
               profile: FarmerProfile, options?: { focusCategory?: string }): Promise<VoiceParseResult>;
}
```

This port is the ONLY boundary between UI and AI. Today `GeminiClient` implements it. Tomorrow the frontend will call a backend REST endpoint instead -- the port contract stays identical.

### Backend AI Status: ZERO

The backend currently has:
- `IOcrExtractionService.cs` -- port defined in plan but **NOT implemented on disk**
- No `Integrations/` folder in Infrastructure
- No AI-related endpoints
- No AI job tracking tables
- The Capacitor plan Phase 3 (OCR) described a `GeminiOcrService.cs` but it was never materialized

### Sarvam API Endpoints (Verified from docs)

| Capability | Endpoint | Method | Auth | Model |
|---|---|---|---|---|
| Speech-to-Text | `POST https://api.sarvam.ai/speech-to-text` | multipart/form-data | `api-subscription-key` header | `saaras:v3` |
| Chat Completions | `POST https://api.sarvam.ai/v1/chat/completions` | application/json | `api-subscription-key` header | `sarvam-m` |
| Document Intelligence | SDK/REST job-based | multipart/form-data | `api-subscription-key` header | `sarvam-vision` |

Sarvam STT supports `mr-IN` (Marathi), `hi-IN` (Hindi), `en-IN` (English), and `unknown` (auto-detect).
Sarvam STT modes: `transcribe`, `translate`, `verbatim`, `codemix`.

### Gemini API (Current, becomes fallback)

| Capability | Model | SDK |
|---|---|---|
| Voice + Vision + Reasoning | `gemini-2.0-flash` | `@google/genai` npm OR `Google.Cloud.AIPlatform` NuGet |

---

## ARCHITECTURAL DECISION: WHERE AI PROCESSING LIVES

### Decision: ALL AI processing moves to the backend.

**Why:**
1. API keys never leave the server
2. Every AI call gets an audit trail (ai_jobs + ai_job_attempts)
3. Provider switching is admin-only, invisible to frontend
4. Prompts and normalization logic live in one place
5. Circuit breaker and retry logic need server-side state
6. Aligns with thin-client migration (frontend sends raw data, gets structured result)

**How frontend changes:**
- Instead of calling Gemini directly, frontend sends audio/image to backend REST endpoints
- Backend returns the EXACT SAME `AgriLogResponse` / `ReceiptExtractionResponse` JSON
- Frontend `VoiceParserPort` implementation changes from `GeminiClient` to `BackendAiClient`
- Zero changes to domain logic, confidence assessor, normalizer (they move to backend)

### Clean Architecture Placement

```
ShramSafal.Domain/
  AI/                          <-- Canonical contracts (value objects, enums)

ShramSafal.Application/
  Ports/External/
    IAiProvider.cs             <-- Provider adapter interface
    IAiOrchestrator.cs         <-- Orchestration service interface
    IAiJobRepository.cs        <-- Job persistence interface
  UseCases/AI/
    ParseVoiceLog/             <-- Use case: audio -> structured log
    ExtractReceipt/            <-- Use case: image -> expense items
    ExtractPattiImage/         <-- Use case: patti image -> sale data

ShramSafal.Infrastructure/
  Integrations/
    Sarvam/                    <-- Sarvam adapter (STT + Vision + LLM)
    Gemini/                    <-- Gemini adapter (multimodal)
  AI/
    AiOrchestrator.cs          <-- Routing, fallback, circuit breaker
    AiPromptBuilder.cs         <-- Migrated from frontend aiPrompts.ts
    AiResponseNormalizer.cs    <-- Migrated from frontend AIResponseNormalizer.ts
    AiContractGate.cs          <-- Migrated from frontend AiContractGate.ts
  Persistence/
    Configurations/
      AiJobConfiguration.cs
      AiJobAttemptConfiguration.cs
      AiProviderConfigConfiguration.cs
    Repositories/
      AiJobRepository.cs

ShramSafal.Api/
  Endpoints/
    AiEndpoints.cs             <-- REST endpoints for AI operations
```

---

## PHASE 0: DOMAIN CONTRACTS (AI VALUE OBJECTS)

**Goal:** Define canonical AI types in the Domain layer. These are pure value objects with ZERO infrastructure dependency. Every layer above references these.

**Prerequisites:** None. This is leaf-node work.

### 0.1 AI Operation Types
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Domain/AI/AiOperationType.cs`** -- CREATE
  ```csharp
  namespace ShramSafal.Domain.AI;

  public enum AiOperationType
  {
      VoiceToStructuredLog = 0,
      ReceiptToExpenseItems = 1,
      PattiImageToSaleData = 2,
      NormalizeAndCompute = 3
  }
  ```

### 0.2 AI Provider Enum
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Domain/AI/AiProviderType.cs`** -- CREATE
  ```csharp
  namespace ShramSafal.Domain.AI;

  public enum AiProviderType
  {
      Sarvam = 0,
      Gemini = 1
  }
  ```

### 0.3 AI Job Status
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Domain/AI/AiJobStatus.cs`** -- CREATE
  ```csharp
  namespace ShramSafal.Domain.AI;

  public enum AiJobStatus
  {
      Queued = 0,
      Running = 1,
      Succeeded = 2,
      Failed = 3,
      FallbackSucceeded = 4
  }
  ```

### 0.4 Failure Taxonomy
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Domain/AI/AiFailureClass.cs`** -- CREATE
  ```csharp
  namespace ShramSafal.Domain.AI;

  public enum AiFailureClass
  {
      None = 0,
      TransientFailure = 1,      // Timeout, 5xx, network
      ProviderRateLimit = 2,     // 429
      ParseFailure = 3,          // Provider returned non-JSON
      SchemaInvalid = 4,         // JSON parsed but failed schema validation
      LowConfidence = 5,         // Below threshold
      UnsupportedInput = 6,      // Language not supported, corrupt file
      UserError = 7              // Empty audio, blank image -- DO NOT fallback
  }
  ```

### 0.5 AI Job Entity (Append-Only)
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Domain/AI/AiJob.cs`** -- CREATE
  ```csharp
  namespace ShramSafal.Domain.AI;

  public class AiJob
  {
      public Guid Id { get; private set; }
      public string IdempotencyKey { get; private set; }       // userId+farmId+clientTimestamp+contentHash
      public AiOperationType OperationType { get; private set; }
      public Guid UserId { get; private set; }
      public Guid FarmId { get; private set; }
      public AiJobStatus Status { get; private set; }
      public string? InputContentHash { get; private set; }    // SHA-256 of audio/image bytes
      public string? InputStoragePath { get; private set; }    // Where raw input is stored
      public string? NormalizedResultJson { get; private set; } // Final canonical output
      public int? InputSpeechDurationMs { get; private set; }  // READINESS #1: speech after silence trim
      public int? InputRawDurationMs { get; private set; }     // READINESS #1: raw recording duration
      public string SchemaVersion { get; private set; } = "1.0.0"; // READINESS #2: output schema version
      public DateTime CreatedAtUtc { get; private set; }
      public DateTime? CompletedAtUtc { get; private set; }
      public int TotalAttempts { get; private set; }
      public DateTime ModifiedAtUtc { get; private set; }

      private readonly List<AiJobAttempt> _attempts = new();
      public IReadOnlyCollection<AiJobAttempt> Attempts => _attempts.AsReadOnly();

      public static AiJob Create(
          Guid id, string idempotencyKey, AiOperationType operationType,
          Guid userId, Guid farmId, string? inputContentHash, string? inputStoragePath);

      public AiJobAttempt AddAttempt(AiProviderType provider);
      public void MarkSucceeded(string normalizedResultJson, AiJobAttempt successfulAttempt);
      public void MarkFailed();
      public void MarkFallbackSucceeded(string normalizedResultJson, AiJobAttempt fallbackAttempt);
  }
  ```

### 0.6 AI Job Attempt Entity (Append-Only)
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Domain/AI/AiJobAttempt.cs`** -- CREATE
  ```csharp
  namespace ShramSafal.Domain.AI;

  public class AiJobAttempt
  {
      public Guid Id { get; private set; }
      public Guid AiJobId { get; private set; }
      public int AttemptNumber { get; private set; }
      public AiProviderType Provider { get; private set; }
      public bool IsSuccess { get; private set; }
      public AiFailureClass FailureClass { get; private set; }
      public string? ErrorMessage { get; private set; }
      public string? RawProviderResponse { get; private set; }  // Stored for audit
      public int LatencyMs { get; private set; }
      public int? TokensUsed { get; private set; }
      public decimal? ConfidenceScore { get; private set; }
      public decimal? EstimatedCostUnits { get; private set; } // READINESS #1: provider-specific cost
      public DateTime AttemptedAtUtc { get; private set; }

      public static AiJobAttempt Create(Guid id, Guid aiJobId, int attemptNumber, AiProviderType provider);
      public void RecordSuccess(string rawResponse, int latencyMs, int? tokens, decimal? confidence);
      public void RecordFailure(AiFailureClass failureClass, string errorMessage, string? rawResponse, int latencyMs);
  }
  ```

### 0.7 AI Provider Configuration (Value Object)
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Domain/AI/AiProviderConfig.cs`** -- CREATE
  ```csharp
  namespace ShramSafal.Domain.AI;

  public class AiProviderConfig
  {
      public Guid Id { get; private set; }
      public AiProviderType DefaultProvider { get; private set; }
      public bool FallbackEnabled { get; private set; }
      public int MaxRetries { get; private set; }
      public int CircuitBreakerThreshold { get; private set; }     // failures before open
      public int CircuitBreakerResetSeconds { get; private set; }
      public decimal VoiceConfidenceThreshold { get; private set; }
      public decimal ReceiptConfidenceThreshold { get; private set; }
      public DateTime ModifiedAtUtc { get; private set; }
      public Guid ModifiedByUserId { get; private set; }

      // Per-operation overrides (nullable = use default)
      public AiProviderType? VoiceProvider { get; private set; }
      public AiProviderType? ReceiptProvider { get; private set; }
      public AiProviderType? PattiProvider { get; private set; }

      public static AiProviderConfig CreateDefault();
      public AiProviderType GetProviderForOperation(AiOperationType operation);
      public void UpdateSettings(/* params */);
  }
  ```

### 0.8 Voice Parse Canonical Result (Value Object)
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Domain/AI/VoiceParseCanonicalResult.cs`** -- CREATE
  ```csharp
  namespace ShramSafal.Domain.AI;

  /// <summary>
  /// Canonical result for voice-to-structured-log.
  /// The JSON serialization of this MUST match the frontend AgriLogResponse schema exactly.
  /// This is a pass-through record -- the actual schema is defined by the prompt contract,
  /// not by C# strong typing. We store it as JSON and validate against the Zod-equivalent schema.
  /// </summary>
  public record VoiceParseCanonicalResult
  {
      public bool Success { get; init; }
      public string? NormalizedJson { get; init; }        // The AgriLogResponse JSON
      public string? RawTranscript { get; init; }
      public decimal OverallConfidence { get; init; }
      public List<string> Warnings { get; init; } = new();
      public string? Error { get; init; }
  }
  ```

### 0.9 Receipt Extract Canonical Result (Value Object)
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Domain/AI/ReceiptExtractCanonicalResult.cs`** -- CREATE
  ```csharp
  namespace ShramSafal.Domain.AI;

  public record ReceiptExtractCanonicalResult
  {
      public bool Success { get; init; }
      public string? NormalizedJson { get; init; }        // ReceiptExtractionResponse JSON
      public decimal OverallConfidence { get; init; }
      public string? RawText { get; init; }
      public List<string> Warnings { get; init; } = new();
      public string? Error { get; init; }
  }
  ```

### PHASE 0 GATE
```bash
dotnet build src/AgriSync.sln
# Zero errors. Domain project has zero new dependencies.

# Verify no infrastructure references
grep -r "using ShramSafal.Infrastructure" src/apps/ShramSafal/ShramSafal.Domain/
# Must return NOTHING
```

---

## PHASE 1: APPLICATION PORTS (PROVIDER & ORCHESTRATOR INTERFACES)

**Goal:** Define the interfaces that Infrastructure will implement. Application layer orchestrates via these ports. No concrete implementations yet.

**Prerequisites:** Phase 0 complete.

### 1.1 AI Provider Port
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Application/Ports/External/IAiProvider.cs`** -- CREATE
  ```csharp
  using ShramSafal.Domain.AI;

  namespace ShramSafal.Application.Ports.External;

  public interface IAiProvider
  {
      AiProviderType ProviderType { get; }
      Task<bool> HealthCheckAsync(CancellationToken ct = default);
      bool CanHandle(AiOperationType operation);

      Task<VoiceParseCanonicalResult> ParseVoiceAsync(
          Stream audioStream, string mimeType, string languageHint,
          string systemPrompt, CancellationToken ct = default);

      Task<ReceiptExtractCanonicalResult> ExtractReceiptAsync(
          Stream imageStream, string mimeType, string systemPrompt,
          CancellationToken ct = default);

      Task<ReceiptExtractCanonicalResult> ExtractPattiAsync(
          Stream imageStream, string mimeType, string systemPrompt,
          CancellationToken ct = default);
  }
  ```

### 1.2 AI Orchestrator Port
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Application/Ports/External/IAiOrchestrator.cs`** -- CREATE
  ```csharp
  using ShramSafal.Domain.AI;

  namespace ShramSafal.Application.Ports.External;

  public interface IAiOrchestrator
  {
      /// <summary>
      /// Selects provider, executes with fallback, persists job, returns result.
      /// </summary>
      Task<(VoiceParseCanonicalResult Result, Guid JobId)> ParseVoiceWithFallbackAsync(
          Guid userId, Guid farmId, Stream audioStream, string mimeType,
          string systemPrompt, string idempotencyKey, CancellationToken ct = default);

      Task<(ReceiptExtractCanonicalResult Result, Guid JobId)> ExtractReceiptWithFallbackAsync(
          Guid userId, Guid farmId, Stream imageStream, string mimeType,
          string systemPrompt, string idempotencyKey, CancellationToken ct = default);

      Task<(ReceiptExtractCanonicalResult Result, Guid JobId)> ExtractPattiWithFallbackAsync(
          Guid userId, Guid farmId, Stream imageStream, string mimeType,
          string systemPrompt, string idempotencyKey, CancellationToken ct = default);
  }
  ```

### 1.3 AI Job Repository Port
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Application/Ports/External/IAiJobRepository.cs`** -- CREATE
  ```csharp
  using ShramSafal.Domain.AI;

  namespace ShramSafal.Application.Ports.External;

  public interface IAiJobRepository
  {
      Task<AiJob?> GetByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default);
      Task<AiJob?> GetByIdAsync(Guid jobId, CancellationToken ct = default);
      Task AddAsync(AiJob job, CancellationToken ct = default);
      Task UpdateAsync(AiJob job, CancellationToken ct = default);
      Task<AiProviderConfig> GetProviderConfigAsync(CancellationToken ct = default);
      Task SaveProviderConfigAsync(AiProviderConfig config, CancellationToken ct = default);
      Task SaveChangesAsync(CancellationToken ct = default);

      // Observability queries
      Task<List<AiJob>> GetRecentJobsAsync(int limit, AiOperationType? operationType, CancellationToken ct = default);
      Task<Dictionary<AiProviderType, int>> GetSuccessCountByProviderAsync(DateTime since, CancellationToken ct = default);
      Task<Dictionary<AiProviderType, int>> GetFailureCountByProviderAsync(DateTime since, CancellationToken ct = default);
  }
  ```

### 1.4 AI Prompt Builder Port
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Application/Ports/External/IAiPromptBuilder.cs`** -- CREATE
  ```csharp
  namespace ShramSafal.Application.Ports.External;

  public interface IAiPromptBuilder
  {
      /// <summary>
      /// Builds the system instruction for voice-to-structured-log parsing.
      /// This is the 700-line prompt migrated from frontend aiPrompts.ts.
      /// </summary>
      string BuildVoiceParsingPrompt(
          VoiceParseContext context);

      string BuildReceiptExtractionPrompt();

      string BuildPattiExtractionPrompt(string cropName);
  }

  public record VoiceParseContext(
      List<CropInfo> AvailableCrops,
      FarmerProfileInfo Profile,
      FarmContextInfo? FarmContext,
      string? FocusCategory,
      VocabDatabaseInfo? VocabDb
  );

  // Lightweight projection types (avoid leaking full domain entities into prompts)
  public record CropInfo(string Id, string Name, List<PlotInfo> Plots);
  public record PlotInfo(string Id, string Name, PlotInfrastructureInfo? Infrastructure, IrrigationPlanInfo? IrrigationPlan);
  public record PlotInfrastructureInfo(string? IrrigationMethod, string? LinkedMotorId, DripDetailsInfo? DripDetails);
  public record DripDetailsInfo(decimal? FlowRatePerHour);
  public record IrrigationPlanInfo(int? DurationMinutes);
  public record FarmerProfileInfo(
      List<MotorInfo> Motors,
      List<WaterResourceInfo> WaterResources,
      List<MachineryInfo> Machineries,
      LedgerDefaultsInfo? LedgerDefaults);
  public record MotorInfo(string Id, string Name, decimal Hp, string? LinkedWaterSourceId);
  public record WaterResourceInfo(string Id, string Name);
  public record MachineryInfo(string Name, string Type, string? Capacity);
  public record LedgerDefaultsInfo(IrrigationDefaultInfo? Irrigation, LabourDefaultInfo? Labour);
  public record IrrigationDefaultInfo(string Method, int DefaultDuration);
  public record LabourDefaultInfo(decimal DefaultWage);
  public record FarmContextInfo(List<SelectedCropContext> Selection);
  public record SelectedCropContext(string CropId, string CropName, List<string> SelectedPlotIds, List<string> SelectedPlotNames);
  public record VocabDatabaseInfo(List<VocabMappingInfo> Mappings);
  public record VocabMappingInfo(string Colloquial, string Standard, string Category, string Context, bool ApprovedByUser, decimal Confidence, string? CropType);
  ```

### PHASE 1 GATE
```bash
dotnet build src/AgriSync.sln
# Zero errors. Application project references Domain only.
```

---

## PHASE 2: AI USE CASES (APPLICATION LAYER)

**Goal:** Create use case handlers for each AI operation. These orchestrate the flow: validate input -> build prompt -> call orchestrator -> persist audit event -> return result.

**Prerequisites:** Phase 1 complete.

### 2.1 Parse Voice Log Use Case
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Application/UseCases/AI/ParseVoiceLog/ParseVoiceLogCommand.cs`** -- CREATE
  ```csharp
  using ShramSafal.Domain.AI;

  namespace ShramSafal.Application.UseCases.AI.ParseVoiceLog;

  public record ParseVoiceLogCommand(
      Guid UserId,
      Guid FarmId,
      Stream AudioStream,
      string MimeType,
      string IdempotencyKey,
      // Context for prompt building
      string ContextJson      // Serialized VoiceParseContext from frontend
  );

  public record ParseVoiceLogResult(
      bool Success,
      string? NormalizedJson,  // AgriLogResponse JSON
      string? RawTranscript,
      decimal OverallConfidence,
      Guid JobId,
      AiProviderType ProviderUsed,
      bool FallbackUsed,
      List<string> Warnings,
      string? Error
  );
  ```

- [ ] **File: `src/apps/ShramSafal/ShramSafal.Application/UseCases/AI/ParseVoiceLog/ParseVoiceLogHandler.cs`** -- CREATE
  - Injects: `IAiOrchestrator`, `IAiPromptBuilder`, `IShramSafalRepository` (for audit)
  - Steps:
    1. Deserialize `ContextJson` into `VoiceParseContext`
    2. Build system prompt via `IAiPromptBuilder.BuildVoiceParsingPrompt(context)`
    3. Call `IAiOrchestrator.ParseVoiceWithFallbackAsync(...)` with idempotency key
    4. If success, create `AuditEvent("AiJob", jobId, "VoiceParsed", userId, ...)`
    5. Return `ParseVoiceLogResult`

### 2.2 Extract Receipt Use Case
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Application/UseCases/AI/ExtractReceipt/ExtractReceiptCommand.cs`** -- CREATE
  ```csharp
  namespace ShramSafal.Application.UseCases.AI.ExtractReceipt;

  public record ExtractReceiptCommand(
      Guid UserId,
      Guid FarmId,
      Stream ImageStream,
      string MimeType,
      string IdempotencyKey
  );

  public record ExtractReceiptResult(
      bool Success,
      string? NormalizedJson,
      decimal OverallConfidence,
      Guid JobId,
      AiProviderType ProviderUsed,
      bool FallbackUsed,
      List<string> Warnings,
      string? Error
  );
  ```

- [ ] **File: `src/apps/ShramSafal/ShramSafal.Application/UseCases/AI/ExtractReceipt/ExtractReceiptHandler.cs`** -- CREATE
  - Same orchestration pattern as voice parse
  - Uses `IAiPromptBuilder.BuildReceiptExtractionPrompt()`

### 2.3 Extract Patti Image Use Case
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Application/UseCases/AI/ExtractPattiImage/ExtractPattiImageCommand.cs`** -- CREATE
  ```csharp
  namespace ShramSafal.Application.UseCases.AI.ExtractPattiImage;

  public record ExtractPattiImageCommand(
      Guid UserId,
      Guid FarmId,
      Stream ImageStream,
      string MimeType,
      string CropName,
      string IdempotencyKey
  );
  ```

- [ ] **File: `src/apps/ShramSafal/ShramSafal.Application/UseCases/AI/ExtractPattiImage/ExtractPattiImageHandler.cs`** -- CREATE
  - Uses `IAiPromptBuilder.BuildPattiExtractionPrompt(cropName)`

### 2.4 Get AI Job Status Use Case
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Application/UseCases/AI/GetAiJobStatus/GetAiJobStatusHandler.cs`** -- CREATE
  - Query: `{ JobId or IdempotencyKey }`
  - Returns: Job status, attempts, result if complete

### 2.5 Update AI Provider Config Use Case (Admin Only)
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Application/UseCases/AI/UpdateProviderConfig/UpdateProviderConfigCommand.cs`** -- CREATE
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Application/UseCases/AI/UpdateProviderConfig/UpdateProviderConfigHandler.cs`** -- CREATE
  - Validates caller is admin
  - Updates `AiProviderConfig`
  - Creates `AuditEvent("AiProviderConfig", configId, "SettingsChanged", ...)`

### 2.6 Get AI Dashboard Stats Use Case (Admin Only)
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Application/UseCases/AI/GetAiDashboard/GetAiDashboardHandler.cs`** -- CREATE
  - Returns: success rate per provider, fallback rate, avg latency, recent failures

### PHASE 2 GATE
```bash
dotnet build src/AgriSync.sln
# Zero errors. No infrastructure references in Application layer.
```

---

## PHASE 3: DATABASE SCHEMA (AI TABLES)

**Goal:** Add EF configurations and migration for AI job tracking and provider settings tables.

**Prerequisites:** Phase 0 complete (domain entities defined).

### 3.1 AiJob EF Configuration
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Configurations/AiJobConfiguration.cs`** -- CREATE
  ```csharp
  // Table: ai_jobs, Schema: ssf
  // Columns: id, idempotency_key, operation_type (string), user_id, farm_id,
  //          status (string), input_content_hash, input_storage_path,
  //          normalized_result_json (jsonb), created_at_utc, completed_at_utc,
  //          total_attempts, modified_at_utc
  // Indexes:
  //   IX_ai_jobs_idempotency_key (UNIQUE)
  //   IX_ai_jobs_user_id
  //   IX_ai_jobs_farm_id
  //   IX_ai_jobs_status
  //   IX_ai_jobs_created_at_utc
  ```

### 3.2 AiJobAttempt EF Configuration
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Configurations/AiJobAttemptConfiguration.cs`** -- CREATE
  ```csharp
  // Table: ai_job_attempts, Schema: ssf
  // Columns: id, ai_job_id (FK -> ai_jobs), attempt_number, provider (string),
  //          is_success, failure_class (string), error_message, raw_provider_response (jsonb),
  //          latency_ms, tokens_used, confidence_score, attempted_at_utc
  // Indexes:
  //   IX_ai_job_attempts_ai_job_id
  //   IX_ai_job_attempts_provider
  //   IX_ai_job_attempts_attempted_at_utc
  // FK: ai_job_id -> ai_jobs.id (cascade delete)
  ```

### 3.3 AiProviderConfig EF Configuration
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Configurations/AiProviderConfigConfiguration.cs`** -- CREATE
  ```csharp
  // Table: ai_provider_configs, Schema: ssf
  // Singleton row pattern (seeded with default)
  // Columns: id, default_provider (string), fallback_enabled, max_retries,
  //          circuit_breaker_threshold, circuit_breaker_reset_seconds,
  //          voice_confidence_threshold, receipt_confidence_threshold,
  //          voice_provider (string, nullable), receipt_provider (string, nullable),
  //          patti_provider (string, nullable),
  //          modified_at_utc, modified_by_user_id
  ```

### 3.4 DbContext Update
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/ShramSafalDbContext.cs`** -- MODIFY
  - Add: `DbSet<AiJob> AiJobs { get; set; }`
  - Add: `DbSet<AiJobAttempt> AiJobAttempts { get; set; }`
  - Add: `DbSet<AiProviderConfig> AiProviderConfigs { get; set; }`

### 3.5 EF Migration
- [ ] Create migration:
  ```bash
  dotnet ef migrations add AddAiOrchestration \
    --project src/apps/ShramSafal/ShramSafal.Infrastructure \
    --startup-project src/AgriSync.Bootstrapper
  ```

### 3.6 Seed Default Provider Config
- [ ] **File: `src/AgriSync.Bootstrapper/Infrastructure/DatabaseSeeder.cs`** -- MODIFY
  - Seed one `AiProviderConfig` row with:
    - DefaultProvider = Sarvam
    - FallbackEnabled = true
    - MaxRetries = 1
    - CircuitBreakerThreshold = 5
    - CircuitBreakerResetSeconds = 60
    - VoiceConfidenceThreshold = 0.6
    - ReceiptConfidenceThreshold = 0.5

### PHASE 3 GATE
```bash
dotnet ef database update \
  --project src/apps/ShramSafal/ShramSafal.Infrastructure \
  --startup-project src/AgriSync.Bootstrapper
# Migration applies. Tables created in ssf schema.

# Verify tables
psql -h localhost -p 5433 -U postgres -d agrisync -c "\dt ssf.ai_*"
# Should show: ai_jobs, ai_job_attempts, ai_provider_configs
```

---

## PHASE 4: GEMINI ADAPTER (REPLICATE EXISTING BEHAVIOR SERVER-SIDE)

**Goal:** Create the Gemini adapter in Infrastructure. This replicates EXACTLY what `GeminiClient.ts`, `receiptExtractionService.ts`, and `pattiImageService.ts` do today -- but server-side. Gemini becomes the known-good baseline before adding Sarvam.

**Prerequisites:** Phase 1 complete (IAiProvider defined).

### 4.1 Gemini HTTP Client
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Integrations/Gemini/GeminiOptions.cs`** -- CREATE
  ```csharp
  namespace ShramSafal.Infrastructure.Integrations.Gemini;

  public class GeminiOptions
  {
      public const string SectionName = "Gemini";
      public string ApiKey { get; set; } = string.Empty;
      public string ModelId { get; set; } = "gemini-2.0-flash";
      public int TimeoutSeconds { get; set; } = 30;
      public string BaseUrl { get; set; } = "https://generativelanguage.googleapis.com/v1beta";
  }
  ```

- [ ] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Integrations/Gemini/GeminiAiProvider.cs`** -- CREATE
  - Implements `IAiProvider`
  - `ProviderType => AiProviderType.Gemini`
  - `CanHandle(*)` => true (Gemini handles all operations)
  - `ParseVoiceAsync`: Sends audio inline to Gemini with system prompt, gets JSON, returns canonical result
  - `ExtractReceiptAsync`: Sends image inline with receipt prompt
  - `ExtractPattiAsync`: Sends image inline with patti prompt
  - `HealthCheckAsync`: Makes a lightweight API call to verify key validity
  - **Critical:** Uses `HttpClient` (not the `@google/genai` npm SDK). Must handle:
    - Markdown code block stripping (`cleanJson` logic from frontend)
    - JSON repair (unquoted keys, trailing commas)
    - Response parsing from Gemini REST API format
  - **NuGet dependency:** None extra needed. Use `System.Net.Http` + `System.Text.Json`

### 4.2 Gemini JSON Cleaner Utility
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Integrations/Gemini/GeminiJsonCleaner.cs`** -- CREATE
  - Port of `GeminiClient.cleanJson()` from TypeScript:
    - Remove markdown code block wrappers
    - Extract JSON object between first `{` and last `}`
    - Fix unquoted keys
    - Fix trailing commas
  - This is Gemini-specific behavior (Sarvam may not need it)

### 4.3 AI Prompt Builder Implementation
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/AI/AiPromptBuilder.cs`** -- CREATE
  - Implements `IAiPromptBuilder`
  - **Port the ENTIRE `buildSystemInstruction()` function from `src/clients/mobile-web/src/services/aiPrompts.ts` (lines 1-657)**
  - Port the ENTIRE `buildPattiParserPrompt()` function (lines 659-710)
  - Port the receipt extraction system prompt from `receiptExtractionService.ts` (lines 5-48)
  - **Critical:** The voice parsing prompt is ~700 lines of battle-tested Marathi/Hindi/English prompting. Do NOT simplify, summarize, or "clean up". Port it character-for-character, converting TypeScript string interpolation to C# string interpolation.
  - The `MARATHI_VOCAB` and `MARATHI_FEW_SHOT_EXAMPLES` referenced in the prompt must be ported from `src/clients/mobile-web/src/shared/utils/marathiPrompts.ts`

### 4.4 Marathi Vocabulary Constants
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/AI/MarathiPromptData.cs`** -- CREATE
  - Port `MARATHI_VOCAB` dictionary from `marathiPrompts.ts`
  - Port `MARATHI_FEW_SHOT_EXAMPLES` from `marathiPrompts.ts`
  - These are static reference data for prompt building

### 4.5 AI Response Normalizer (C# Port)
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/AI/AiResponseNormalizer.cs`** -- CREATE
  - Port of `src/clients/mobile-web/src/infrastructure/ai/AIResponseNormalizer.ts`
  - Fills default IDs, normalizes enums, ensures all required arrays exist
  - Works on `JsonDocument` or `JsonNode` (not strongly typed -- the schema is complex)

### 4.6 Configuration
- [ ] **File: `src/AgriSync.Bootstrapper/appsettings.json`** -- MODIFY
  - Add section:
    ```json
    "Gemini": {
      "ApiKey": "CHANGE_ME",
      "ModelId": "gemini-2.0-flash",
      "TimeoutSeconds": 30
    }
    ```

- [ ] **File: `src/AgriSync.Bootstrapper/appsettings.Development.json`** -- MODIFY
  - Add Gemini section with actual dev API key or env variable reference

### PHASE 4 GATE
```bash
dotnet build src/AgriSync.sln
# Zero errors

# Unit test: GeminiJsonCleaner handles markdown-wrapped JSON
dotnet test --filter "GeminiJsonCleaner"
# All pass

# Unit test: AiPromptBuilder generates non-empty prompt
dotnet test --filter "AiPromptBuilder"
# All pass
```

---

## PHASE 5: SARVAM ADAPTER

**Goal:** Create the Sarvam adapter. For voice parsing, Sarvam is a TWO-STEP pipeline (STT then LLM). For receipts, it's image-to-text (Vision) then LLM. The adapter hides this complexity.

**Prerequisites:** Phase 1 complete (IAiProvider defined).

### 5.1 Sarvam Options
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Integrations/Sarvam/SarvamOptions.cs`** -- CREATE
  ```csharp
  namespace ShramSafal.Infrastructure.Integrations.Sarvam;

  public class SarvamOptions
  {
      public const string SectionName = "Sarvam";
      public string ApiSubscriptionKey { get; set; } = string.Empty;
      public string SttEndpoint { get; set; } = "https://api.sarvam.ai/speech-to-text";
      public string SttModel { get; set; } = "saaras:v3";
      public string SttMode { get; set; } = "transcribe";
      public string SttLanguage { get; set; } = "unknown";  // auto-detect
      public string ChatEndpoint { get; set; } = "https://api.sarvam.ai/v1/chat/completions";
      public string ChatModel { get; set; } = "sarvam-m";
      public decimal ChatTemperature { get; set; } = 0.2m;
      public int TimeoutSeconds { get; set; } = 45;
      // Document Intelligence is SDK-based (job pattern) -- separate timeout
      public int DocIntelTimeoutSeconds { get; set; } = 120;
  }
  ```

### 5.2 Sarvam STT Client
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Integrations/Sarvam/SarvamSttClient.cs`** -- CREATE
  - Sends audio to `POST https://api.sarvam.ai/speech-to-text` as `multipart/form-data`
  - Fields: `file` (binary), `model` = `saaras:v3`, `language_code` = `mr-IN` (or `unknown`), `mode` = `transcribe`
  - Header: `api-subscription-key: {key}`
  - Returns: `{ transcript, language_code, language_probability, timestamps }`
  - Handles errors: 400, 403, 422, 429, 500, 503

### 5.3 Sarvam Chat Client
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Integrations/Sarvam/SarvamChatClient.cs`** -- CREATE
  - Sends JSON to `POST https://api.sarvam.ai/v1/chat/completions`
  - Body: `{ model: "sarvam-m", messages: [{role:"system", content:systemPrompt}, {role:"user", content:transcript}], temperature: 0.2 }`
  - Header: `api-subscription-key: {key}`
  - Returns: `{ choices[0].message.content }` (the JSON-formatted log response)

### 5.4 Sarvam Vision Client (Document Intelligence)
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Integrations/Sarvam/SarvamVisionClient.cs`** -- CREATE
  - For receipt/patti OCR
  - Sends image to Sarvam Document Intelligence API
  - Returns extracted text/markdown
  - Falls back to sending base64 image to sarvam-m chat if Document Intelligence is unavailable

### 5.5 Sarvam AI Provider (Composite Adapter)
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Integrations/Sarvam/SarvamAiProvider.cs`** -- CREATE
  - Implements `IAiProvider`
  - `ProviderType => AiProviderType.Sarvam`
  - **`ParseVoiceAsync` (TWO-STEP PIPELINE):**
    1. Call `SarvamSttClient.TranscribeAsync(audioStream)` -> get Marathi transcript
    2. Call `SarvamChatClient.CompleteAsync(systemPrompt, transcript)` -> get structured JSON
    3. Parse JSON, normalize, return `VoiceParseCanonicalResult`
    - If STT fails -> return failure with `AiFailureClass.TransientFailure`
    - If LLM returns non-JSON -> return failure with `AiFailureClass.ParseFailure`
  - **`ExtractReceiptAsync` (TWO-STEP PIPELINE):**
    1. Call `SarvamVisionClient.ExtractTextAsync(imageStream)` -> get raw text/fields
    2. Call `SarvamChatClient.CompleteAsync(receiptPrompt, extractedText)` -> structured JSON
    3. Normalize, return canonical result
  - **`ExtractPattiAsync`:** Same pattern with patti-specific prompt
  - **`HealthCheckAsync`:** Lightweight STT call with a 1-second silent audio clip

### 5.6 Configuration
- [ ] **File: `src/AgriSync.Bootstrapper/appsettings.json`** -- MODIFY
  - Add section:
    ```json
    "Sarvam": {
      "ApiSubscriptionKey": "CHANGE_ME",
      "SttModel": "saaras:v3",
      "SttMode": "transcribe",
      "SttLanguage": "unknown",
      "ChatModel": "sarvam-m",
      "ChatTemperature": 0.2,
      "TimeoutSeconds": 45
    }
    ```

### PHASE 5 GATE
```bash
dotnet build src/AgriSync.sln
# Zero errors

# Unit test: SarvamSttClient formats multipart correctly
dotnet test --filter "SarvamStt"

# Unit test: SarvamChatClient formats JSON body correctly
dotnet test --filter "SarvamChat"
```

---

## PHASE 6: AI ORCHESTRATOR (ROUTING + FALLBACK + CIRCUIT BREAKER)

**Goal:** Build the orchestrator that ties everything together. It selects the provider, executes with fallback, manages circuit breaker state, and persists all job data.

**Prerequisites:** Phases 3, 4, 5 complete.

### 6.1 Circuit Breaker
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/AI/CircuitBreaker.cs`** -- CREATE
  ```csharp
  namespace ShramSafal.Infrastructure.AI;

  /// <summary>
  /// In-memory circuit breaker per provider. Thread-safe.
  /// States: Closed (healthy) -> Open (failing) -> HalfOpen (testing)
  /// </summary>
  public class CircuitBreaker
  {
      public CircuitBreakerState State { get; }
      public int FailureCount { get; }

      public CircuitBreaker(int threshold, TimeSpan resetInterval);
      public bool AllowRequest();
      public void RecordSuccess();
      public void RecordFailure();
  }

  public enum CircuitBreakerState { Closed, Open, HalfOpen }
  ```

### 6.2 AI Orchestrator Implementation
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/AI/AiOrchestrator.cs`** -- CREATE
  - Implements `IAiOrchestrator`
  - Constructor injects:
    - `IEnumerable<IAiProvider>` (all registered providers)
    - `IAiJobRepository`
    - `ILogger<AiOrchestrator>`
  - Maintains `Dictionary<AiProviderType, CircuitBreaker>` (in-memory, per-provider)
  - **`ParseVoiceWithFallbackAsync` logic:**
    1. Check idempotency: if job exists with same key and succeeded -> return cached result
    2. Create `AiJob` (status=Queued)
    3. Get `AiProviderConfig` from DB
    4. Determine primary provider for `VoiceToStructuredLog` operation
    5. If circuit breaker allows:
       a. Create `AiJobAttempt` for primary provider
       b. Call `IAiProvider.ParseVoiceAsync(...)`
       c. If success and confidence >= threshold -> record success, return
       d. If failure -> classify failure, record attempt
    6. If primary failed AND fallback enabled AND failure class is fallback-eligible:
       a. Create `AiJobAttempt` for fallback provider
       b. Call fallback provider
       c. If success -> mark job as `FallbackSucceeded`
       d. If failure -> mark job as `Failed`
    7. Persist job + attempts
    8. Return result
  - **Fallback-eligible failure classes:** `TransientFailure`, `ProviderRateLimit`, `ParseFailure`, `SchemaInvalid`, `LowConfidence`
  - **NOT fallback-eligible:** `UserError`, `UnsupportedInput`

### 6.3 AI Job Repository Implementation
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Repositories/AiJobRepository.cs`** -- CREATE
  - Implements `IAiJobRepository`
  - Uses `ShramSafalDbContext`
  - All queries scoped to ssf schema

### 6.4 DI Registration
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/DependencyInjection.cs`** -- MODIFY
  - Register `SarvamAiProvider` as `IAiProvider`
  - Register `GeminiAiProvider` as `IAiProvider`
  - Register `AiOrchestrator` as `IAiOrchestrator` (Singleton for circuit breaker state)
  - Register `AiJobRepository` as `IAiJobRepository`
  - Register `AiPromptBuilder` as `IAiPromptBuilder`
  - Register `HttpClient` instances for Sarvam and Gemini (named clients with timeouts)
  - Bind `GeminiOptions` from config
  - Bind `SarvamOptions` from config

- [ ] **File: `src/apps/ShramSafal/ShramSafal.Api/DependencyInjection.cs`** -- MODIFY
  - Register AI use case handlers

### PHASE 6 GATE
```bash
dotnet build src/AgriSync.sln
# Zero errors

# Integration test: Orchestrator with mock providers
dotnet test --filter "AiOrchestrator"
# Tests:
#   - Primary succeeds -> returns primary result
#   - Primary fails transiently -> falls back to secondary -> succeeds
#   - Both fail -> returns failure
#   - Idempotency key hit -> returns cached result
#   - Circuit breaker opens after N failures -> skips primary
#   - UserError -> does NOT fallback
```

---

## PHASE 7: API ENDPOINTS

**Goal:** Expose AI operations as REST endpoints. Frontend will call these instead of Gemini directly.

**Prerequisites:** Phase 6 complete. Orchestrator works.

### 7.1 AI Endpoints
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Api/Endpoints/AiEndpoints.cs`** -- CREATE

  **`POST /shramsafal/ai/voice-parse`**
  - Auth required. UserId from JWT claims.
  - Request: `multipart/form-data`
    - `audio` (file, required): Audio file (WAV, MP3, WebM, OGG, etc.)
    - `farmId` (string, required): Farm GUID
    - `context` (string, required): JSON-serialized `VoiceParseContext`
    - `idempotencyKey` (string, required): Client-generated key
  - Response 200:
    ```json
    {
      "success": true,
      "normalizedJson": { /* AgriLogResponse -- SAME schema as frontend expects */ },
      "rawTranscript": "...",
      "overallConfidence": 0.85,
      "jobId": "guid",
      "providerUsed": "Sarvam",
      "fallbackUsed": false,
      "warnings": []
    }
    ```
  - Response 422: Schema validation failure
  - Response 503: Both providers failed

  **`POST /shramsafal/ai/receipt-extract`**
  - Auth required.
  - Request: `multipart/form-data`
    - `image` (file): Receipt image (JPEG, PNG)
    - `farmId` (string)
    - `idempotencyKey` (string)
  - Response 200: `ReceiptExtractionResponse` JSON

  **`POST /shramsafal/ai/patti-extract`**
  - Auth required.
  - Request: `multipart/form-data`
    - `image` (file): Patti image
    - `farmId` (string)
    - `cropName` (string)
    - `idempotencyKey` (string)
  - Response 200: Patti extraction JSON

  **`GET /shramsafal/ai/jobs/{jobId}`**
  - Auth required.
  - Returns: Job status, attempts, result

  **`GET /shramsafal/ai/config`** (Admin only)
  - Returns: Current AiProviderConfig

  **`PUT /shramsafal/ai/config`** (Admin only)
  - Updates: Provider settings
  - Audited.

  **`GET /shramsafal/ai/dashboard`** (Admin only)
  - Returns: Success rates, fallback rates, latency, recent failures

  **`GET /shramsafal/ai/health`**
  - Returns: Per-provider health status (circuit breaker state, last success time)

### 7.2 Module Registration
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Api/ModuleEndpoints.cs`** -- MODIFY
  - Add: `AiEndpoints.Map(group)` in the ShramSafal endpoint group

### PHASE 7 GATE
```bash
dotnet build src/AgriSync.sln
# Zero errors

# Smoke test: voice parse endpoint
curl -X POST localhost:5048/shramsafal/ai/voice-parse \
  -H "Authorization: Bearer {token}" \
  -F "audio=@test-audio.webm" \
  -F "farmId={farmId}" \
  -F "context={}" \
  -F "idempotencyKey=test-001"
# Returns AgriLogResponse JSON

# Smoke test: health
curl localhost:5048/shramsafal/ai/health \
  -H "Authorization: Bearer {token}"
# Returns provider health status
```

---

## PHASE 8: FRONTEND MIGRATION (REMOVE CLIENT-SIDE AI)

**Goal:** Replace ALL direct Gemini calls in the frontend with backend REST calls. The frontend becomes a true thin client for AI operations. The existing `VoiceParserPort` interface stays -- only the implementation changes.

**Prerequisites:** Phase 7 complete. Backend AI endpoints work.

### 8.1 Backend AI Client (Replaces GeminiClient)
- [ ] **File: `src/clients/mobile-web/src/infrastructure/ai/BackendAiClient.ts`** -- CREATE
  ```typescript
  import { VoiceParserPort, VoiceInput, VoiceParseResult } from '../../application/ports';
  import { LogScope } from '../../domain/types/log.types';
  import { CropProfile, FarmerProfile } from '../../types';
  import { AgriSyncClient } from '../api/AgriSyncClient';
  import { AIResponseNormalizer } from './AIResponseNormalizer';
  import { assessConfidence } from '../../domain/ai/ConfidenceAssessor';
  import { systemClock } from '../../core/domain/services/Clock';

  export class BackendAiClient implements VoiceParserPort {
      private apiClient: AgriSyncClient;

      constructor(apiClient: AgriSyncClient) {
          this.apiClient = apiClient;
      }

      async parseInput(
          input: VoiceInput,
          scope: LogScope,
          crops: CropProfile[],
          profile: FarmerProfile,
          options?: { focusCategory?: string }
      ): Promise<VoiceParseResult> {
          // Build context object that backend needs for prompt construction
          const context = this.buildContext(scope, crops, profile, options);

          if (input.type === 'audio') {
              // Convert base64 to Blob
              const audioBlob = this.base64ToBlob(input.data, input.mimeType);
              const result = await this.apiClient.parseVoiceLog(
                  audioBlob, input.mimeType, context
              );
              return this.mapToVoiceParseResult(result);
          } else {
              // Text input: send as audio-less request
              // Backend handles text-only parsing via LLM directly
              const result = await this.apiClient.parseTextLog(
                  input.content, context
              );
              return this.mapToVoiceParseResult(result);
          }
      }
      // ... helper methods
  }
  ```

### 8.2 AgriSyncClient AI Methods
- [ ] **File: `src/clients/mobile-web/src/infrastructure/api/AgriSyncClient.ts`** -- MODIFY
  - Add method: `parseVoiceLog(audio: Blob, mimeType: string, context: object): Promise<AiParseResponse>`
    - Calls `POST /shramsafal/ai/voice-parse` with multipart/form-data
  - Add method: `parseTextLog(text: string, context: object): Promise<AiParseResponse>`
    - Calls `POST /shramsafal/ai/voice-parse` with text content
  - Add method: `extractReceipt(image: Blob, mimeType: string): Promise<ReceiptExtractionResponse>`
    - Calls `POST /shramsafal/ai/receipt-extract`
  - Add method: `extractPatti(image: Blob, mimeType: string, cropName: string): Promise<any>`
    - Calls `POST /shramsafal/ai/patti-extract`
  - Add method: `getAiJobStatus(jobId: string): Promise<AiJobStatus>`
  - Add method: `getAiHealth(): Promise<AiHealthResponse>`

### 8.3 Composition Root Update
- [ ] **File: `src/clients/mobile-web/src/app/compositionRoot.ts`** -- MODIFY
  - Replace `GeminiClient` instantiation with `BackendAiClient` instantiation
  - `BackendAiClient` receives `AgriSyncClient` instance
  - **Critical:** The `VoiceParserPort` binding changes from:
    ```typescript
    const voiceParser: VoiceParserPort = new GeminiClient();
    ```
    to:
    ```typescript
    const voiceParser: VoiceParserPort = new BackendAiClient(apiClient);
    ```
  - Nothing else in the app changes because everything depends on the port, not the implementation

### 8.4 Receipt Extraction Migration
- [ ] **File: `src/clients/mobile-web/src/services/receiptExtractionService.ts`** -- MODIFY
  - Replace direct Gemini call with `AgriSyncClient.extractReceipt()`
  - Same response format (backend returns identical JSON)

### 8.5 Patti Image Service Migration
- [ ] **File: `src/clients/mobile-web/src/services/pattiImageService.ts`** -- MODIFY
  - Replace direct Gemini call with `AgriSyncClient.extractPatti()`

### 8.6 Vocab Learner Migration
- [ ] **File: `src/clients/mobile-web/src/services/vocabLearner.ts`** -- MODIFY
  - Remove direct Gemini API call in `callGeminiForVocabLearning()`
  - Two options (pick one):
    - **Option A:** Move vocab learning server-side (new endpoint)
    - **Option B (simpler):** Keep vocab learning client-side but call backend `/ai/voice-parse` with a vocab-learning prompt
  - **Recommended: Option A** -- add `POST /shramsafal/ai/vocab-learn` endpoint. But this is non-critical. Can defer.
  - For now: remove the direct Gemini call, disable vocab learning until server-side support is added

### 8.7 Remove Client-Side API Key
- [ ] **File: `src/clients/mobile-web/.env`** -- MODIFY
  - Remove `VITE_GEMINI_API_KEY` (no longer needed)
- [ ] **File: `src/clients/mobile-web/.env.example`** -- MODIFY
  - Remove `VITE_GEMINI_API_KEY`
- [ ] **File: `src/clients/mobile-web/.env.local`** -- MODIFY
  - Remove `VITE_GEMINI_API_KEY`

### 8.8 Dependency Cleanup
- [ ] **File: `src/clients/mobile-web/package.json`** -- MODIFY
  - Remove `@google/genai` from dependencies (no longer used client-side)
  - Run `npm install` to update lockfile

### 8.9 Offline Resilience
- [ ] When offline:
  - Voice parsing: Store raw audio locally (in Dexie `pendingAiJobs` table), queue for processing when online
  - Receipt extraction: Store image locally, queue for processing
  - Show user: "Saved locally. Will process when connected."
- [ ] **File: `src/clients/mobile-web/src/infrastructure/storage/DexieDatabase.ts`** -- MODIFY
  - Add table: `pendingAiJobs` with schema `++id, operationType, inputBlob, context, status, createdAt`
- [ ] **File: `src/clients/mobile-web/src/infrastructure/sync/BackgroundSyncWorker.ts`** -- MODIFY
  - Add: process `pendingAiJobs` queue alongside mutation queue
  - On connectivity restored: submit pending AI jobs to backend

### PHASE 8 GATE
```bash
# Frontend builds without @google/genai
cd src/clients/mobile-web && npm run build
# Zero errors

# No Gemini API key in client bundle
grep -r "VITE_GEMINI_API_KEY" src/clients/mobile-web/dist/
# Returns NOTHING

# No direct Gemini SDK import in source (except old GeminiClient.ts which is now unused)
grep -r "from.*@google/genai" src/clients/mobile-web/src/ --include="*.ts" --include="*.tsx" | grep -v "GeminiClient.ts"
# Returns NOTHING

# TypeScript compiles
cd src/clients/mobile-web && npx tsc --noEmit
# Zero errors

# Voice parse works end-to-end via backend
# Manual test: record audio in app -> sends to backend -> gets structured response
```

---

## PHASE 9: TESTS & QUALITY GATES

**Goal:** Comprehensive tests for the AI orchestration layer. Unit tests for each adapter. Integration tests for the full pipeline. Golden set tests for Marathi audio.

**Prerequisites:** Phases 4-8 complete.

### 9.1 Domain Tests
- [ ] **File: `src/tests/ShramSafal.Domain.Tests/AI/AiJobTests.cs`** -- CREATE
  - Test: Create job -> status Queued
  - Test: Add attempt -> increments TotalAttempts
  - Test: MarkSucceeded -> status Succeeded, CompletedAtUtc set
  - Test: MarkFallbackSucceeded -> status FallbackSucceeded
  - Test: MarkFailed -> status Failed
  - Test: Idempotency key uniqueness

### 9.2 Orchestrator Tests
- [ ] **File: `src/tests/ShramSafal.Domain.Tests/AI/AiOrchestratorTests.cs`** -- CREATE
  - Test: Primary succeeds -> no fallback
  - Test: Primary transient failure -> fallback called
  - Test: Primary UserError -> NO fallback
  - Test: Both fail -> job Failed
  - Test: Idempotency cache hit -> returns cached
  - Test: Circuit breaker opens -> skips to fallback immediately
  - Test: Circuit breaker resets after timeout

### 9.3 Adapter Unit Tests
- [ ] **File: `src/tests/ShramSafal.Domain.Tests/AI/GeminiAdapterTests.cs`** -- CREATE
  - Test: JSON cleaner handles markdown blocks
  - Test: JSON cleaner handles trailing commas
  - Test: Response parsing extracts content correctly

- [ ] **File: `src/tests/ShramSafal.Domain.Tests/AI/SarvamAdapterTests.cs`** -- CREATE
  - Test: STT request formats multipart correctly
  - Test: Chat request formats JSON correctly
  - Test: Two-step pipeline chains STT -> LLM

### 9.4 Integration Tests
- [ ] **File: `src/tests/ShramSafal.Sync.IntegrationTests/AiEndpointsTests.cs`** -- CREATE
  - Test: `POST /ai/voice-parse` with test audio -> returns valid AgriLogResponse
  - Test: `POST /ai/receipt-extract` with test image -> returns valid extraction
  - Test: Idempotent retry returns same result
  - Test: Health endpoint returns provider status
  - Test: Config endpoint returns current settings (admin)

### 9.5 Prompt Regression Tests
- [ ] **File: `src/tests/ShramSafal.Domain.Tests/AI/AiPromptBuilderTests.cs`** -- CREATE
  - Test: Voice prompt contains all critical sections (SECURITY OVERRIDE, MARATHI VOCAB, OUTPUT SCHEMA, USE CASES)
  - Test: Receipt prompt contains category list
  - Test: Patti prompt includes crop name
  - Test: Prompt length is within reasonable bounds (not accidentally truncated)

### PHASE 9 GATE
```bash
dotnet test src/AgriSync.sln
# All tests pass

dotnet test --filter "AI"
# All AI-specific tests pass
```

---

## PHASE 10: OBSERVABILITY & ADMIN CONTROLS

**Goal:** Admin-only dashboard data and settings controls. Not a full UI yet -- just the backend support and basic frontend hooks.

**Prerequisites:** Phase 7 complete (endpoints exist).

### 10.1 AI Dashboard DTO
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Application/Contracts/Dtos/AiDashboardDto.cs`** -- CREATE
  ```csharp
  public record AiDashboardDto(
      AiProviderConfigDto Config,
      Dictionary<string, ProviderStatsDto> ProviderStats,  // keyed by provider name
      List<AiJobSummaryDto> RecentJobs
  );

  public record AiProviderConfigDto(
      string DefaultProvider,
      bool FallbackEnabled,
      int MaxRetries,
      string? VoiceProviderOverride,
      string? ReceiptProviderOverride
  );

  public record ProviderStatsDto(
      int TotalJobs,
      int Successes,
      int Failures,
      int FallbacksTriggered,
      double AvgLatencyMs,
      double SuccessRate,
      string CircuitBreakerState,
      DateTime? LastSuccessUtc,
      DateTime? LastFailureUtc
  );

  public record AiJobSummaryDto(
      Guid Id,
      string OperationType,
      string Status,
      string ProviderUsed,
      bool FallbackUsed,
      int LatencyMs,
      decimal? Confidence,
      DateTime CreatedAtUtc
  );
  ```

### 10.2 Settings Change Audit
- [ ] Every change to `AiProviderConfig` creates an `AuditEvent` with:
  - EntityType: `"AiProviderConfig"`
  - Action: `"SettingsChanged"`
  - Payload: JSON diff of old vs new settings

### 10.3 Frontend Admin Hook (Optional in this phase)
- [ ] **File: `src/clients/mobile-web/src/app/hooks/useAiDashboard.ts`** -- CREATE
  - Fetches from `GET /shramsafal/ai/dashboard`
  - Returns typed dashboard data
  - Only available to admin role

### PHASE 10 GATE
```bash
curl localhost:5048/shramsafal/ai/dashboard \
  -H "Authorization: Bearer {admin-token}"
# Returns dashboard JSON with stats

curl -X PUT localhost:5048/shramsafal/ai/config \
  -H "Authorization: Bearer {admin-token}" \
  -H "Content-Type: application/json" \
  -d '{"defaultProvider":"Gemini","fallbackEnabled":true}'
# Returns updated config

# Audit event created
curl "localhost:5048/shramsafal/audit?entityType=AiProviderConfig" \
  -H "Authorization: Bearer {admin-token}"
# Shows settings change event
```

---

## DEPENDENCY MAP

```
Phase 0 (Domain Contracts)
    |
    +-- Phase 1 (Application Ports)
    |       |
    |       +-- Phase 2 (Use Cases)
    |       |
    |       +-- Phase 4 (Gemini Adapter)
    |       |
    |       +-- Phase 5 (Sarvam Adapter)
    |
    +-- Phase 3 (DB Schema)
            |
            +-- Phase 6 (Orchestrator) -- depends on 3, 4, 5
                    |
                    +-- Phase 7 (API Endpoints)
                            |
                            +-- Phase 8 (Frontend Migration)
                            |
                            +-- Phase 9 (Tests)
                            |
                            +-- Phase 10 (Admin/Observability)
```

Phases 4 and 5 can be built IN PARALLEL (they're independent adapters).
Phase 3 can be built IN PARALLEL with Phases 4/5.
Phase 2 can be built IN PARALLEL with Phases 3/4/5 (uses only ports, no implementations).

**Critical path:** 0 -> 1 -> (2,3,4,5 in parallel) -> 6 -> 7 -> 8

---

## SECURITY CHECKLIST

- [ ] Gemini API key NEVER in frontend bundle
- [ ] Sarvam API key NEVER in frontend bundle
- [ ] All AI endpoints require JWT authentication
- [ ] UserId extracted from claims, NEVER from request body
- [ ] FarmId validated against user membership before processing
- [ ] Raw provider responses stored access-controlled (admin only)
- [ ] Admin settings changes audited
- [ ] No PII in prompt builder beyond farm context
- [ ] Audio/image inputs validated for type and size before processing

---

## FILE CREATION SUMMARY

### New Files (Backend)
| # | Path | Layer |
|---|---|---|
| 1 | `src/apps/ShramSafal/ShramSafal.Domain/AI/AiOperationType.cs` | Domain |
| 2 | `src/apps/ShramSafal/ShramSafal.Domain/AI/AiProviderType.cs` | Domain |
| 3 | `src/apps/ShramSafal/ShramSafal.Domain/AI/AiJobStatus.cs` | Domain |
| 4 | `src/apps/ShramSafal/ShramSafal.Domain/AI/AiFailureClass.cs` | Domain |
| 5 | `src/apps/ShramSafal/ShramSafal.Domain/AI/AiJob.cs` | Domain |
| 6 | `src/apps/ShramSafal/ShramSafal.Domain/AI/AiJobAttempt.cs` | Domain |
| 7 | `src/apps/ShramSafal/ShramSafal.Domain/AI/AiProviderConfig.cs` | Domain |
| 8 | `src/apps/ShramSafal/ShramSafal.Domain/AI/VoiceParseCanonicalResult.cs` | Domain |
| 9 | `src/apps/ShramSafal/ShramSafal.Domain/AI/ReceiptExtractCanonicalResult.cs` | Domain |
| 10 | `src/apps/ShramSafal/ShramSafal.Application/Ports/External/IAiProvider.cs` | Application |
| 11 | `src/apps/ShramSafal/ShramSafal.Application/Ports/External/IAiOrchestrator.cs` | Application |
| 12 | `src/apps/ShramSafal/ShramSafal.Application/Ports/External/IAiJobRepository.cs` | Application |
| 13 | `src/apps/ShramSafal/ShramSafal.Application/Ports/External/IAiPromptBuilder.cs` | Application |
| 14 | `src/apps/ShramSafal/ShramSafal.Application/UseCases/AI/ParseVoiceLog/ParseVoiceLogCommand.cs` | Application |
| 15 | `src/apps/ShramSafal/ShramSafal.Application/UseCases/AI/ParseVoiceLog/ParseVoiceLogHandler.cs` | Application |
| 16 | `src/apps/ShramSafal/ShramSafal.Application/UseCases/AI/ExtractReceipt/ExtractReceiptCommand.cs` | Application |
| 17 | `src/apps/ShramSafal/ShramSafal.Application/UseCases/AI/ExtractReceipt/ExtractReceiptHandler.cs` | Application |
| 18 | `src/apps/ShramSafal/ShramSafal.Application/UseCases/AI/ExtractPattiImage/ExtractPattiImageCommand.cs` | Application |
| 19 | `src/apps/ShramSafal/ShramSafal.Application/UseCases/AI/ExtractPattiImage/ExtractPattiImageHandler.cs` | Application |
| 20 | `src/apps/ShramSafal/ShramSafal.Application/UseCases/AI/GetAiJobStatus/GetAiJobStatusHandler.cs` | Application |
| 21 | `src/apps/ShramSafal/ShramSafal.Application/UseCases/AI/UpdateProviderConfig/UpdateProviderConfigCommand.cs` | Application |
| 22 | `src/apps/ShramSafal/ShramSafal.Application/UseCases/AI/UpdateProviderConfig/UpdateProviderConfigHandler.cs` | Application |
| 23 | `src/apps/ShramSafal/ShramSafal.Application/UseCases/AI/GetAiDashboard/GetAiDashboardHandler.cs` | Application |
| 24 | `src/apps/ShramSafal/ShramSafal.Application/Contracts/Dtos/AiDashboardDto.cs` | Application |
| 25 | `src/apps/ShramSafal/ShramSafal.Infrastructure/Integrations/Gemini/GeminiOptions.cs` | Infrastructure |
| 26 | `src/apps/ShramSafal/ShramSafal.Infrastructure/Integrations/Gemini/GeminiAiProvider.cs` | Infrastructure |
| 27 | `src/apps/ShramSafal/ShramSafal.Infrastructure/Integrations/Gemini/GeminiJsonCleaner.cs` | Infrastructure |
| 28 | `src/apps/ShramSafal/ShramSafal.Infrastructure/Integrations/Sarvam/SarvamOptions.cs` | Infrastructure |
| 29 | `src/apps/ShramSafal/ShramSafal.Infrastructure/Integrations/Sarvam/SarvamSttClient.cs` | Infrastructure |
| 30 | `src/apps/ShramSafal/ShramSafal.Infrastructure/Integrations/Sarvam/SarvamChatClient.cs` | Infrastructure |
| 31 | `src/apps/ShramSafal/ShramSafal.Infrastructure/Integrations/Sarvam/SarvamVisionClient.cs` | Infrastructure |
| 32 | `src/apps/ShramSafal/ShramSafal.Infrastructure/Integrations/Sarvam/SarvamAiProvider.cs` | Infrastructure |
| 33 | `src/apps/ShramSafal/ShramSafal.Infrastructure/AI/CircuitBreaker.cs` | Infrastructure |
| 34 | `src/apps/ShramSafal/ShramSafal.Infrastructure/AI/AiOrchestrator.cs` | Infrastructure |
| 35 | `src/apps/ShramSafal/ShramSafal.Infrastructure/AI/AiPromptBuilder.cs` | Infrastructure |
| 36 | `src/apps/ShramSafal/ShramSafal.Infrastructure/AI/MarathiPromptData.cs` | Infrastructure |
| 37 | `src/apps/ShramSafal/ShramSafal.Infrastructure/AI/AiResponseNormalizer.cs` | Infrastructure |
| 38 | `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Configurations/AiJobConfiguration.cs` | Infrastructure |
| 39 | `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Configurations/AiJobAttemptConfiguration.cs` | Infrastructure |
| 40 | `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Configurations/AiProviderConfigConfiguration.cs` | Infrastructure |
| 41 | `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Repositories/AiJobRepository.cs` | Infrastructure |
| 42 | `src/apps/ShramSafal/ShramSafal.Api/Endpoints/AiEndpoints.cs` | Api |

### New Files (Frontend)
| # | Path |
|---|---|
| 43 | `src/clients/mobile-web/src/infrastructure/ai/BackendAiClient.ts` |
| 44 | `src/clients/mobile-web/src/app/hooks/useAiDashboard.ts` |

### Modified Files (Backend)
| # | Path | Change |
|---|---|---|
| 1 | `ShramSafal.Infrastructure/Persistence/ShramSafalDbContext.cs` | Add 3 DbSets |
| 2 | `ShramSafal.Infrastructure/DependencyInjection.cs` | Register AI services |
| 3 | `ShramSafal.Api/DependencyInjection.cs` | Register AI handlers |
| 4 | `ShramSafal.Api/ModuleEndpoints.cs` | Map AI endpoints |
| 5 | `AgriSync.Bootstrapper/appsettings.json` | Add Gemini + Sarvam config |
| 6 | `AgriSync.Bootstrapper/appsettings.Development.json` | Add dev keys |
| 7 | `AgriSync.Bootstrapper/Infrastructure/DatabaseSeeder.cs` | Seed default AI config |

### Modified Files (Frontend)
| # | Path | Change |
|---|---|---|
| 1 | `src/infrastructure/api/AgriSyncClient.ts` | Add AI methods |
| 2 | `src/app/compositionRoot.ts` | Swap GeminiClient -> BackendAiClient |
| 3 | `src/services/receiptExtractionService.ts` | Use backend instead of Gemini |
| 4 | `src/services/pattiImageService.ts` | Use backend instead of Gemini |
| 5 | `src/services/vocabLearner.ts` | Remove direct Gemini call |
| 6 | `src/infrastructure/storage/DexieDatabase.ts` | Add pendingAiJobs table |
| 7 | `src/infrastructure/sync/BackgroundSyncWorker.ts` | Process AI job queue |
| 8 | `.env` / `.env.example` / `.env.local` | Remove VITE_GEMINI_API_KEY |
| 9 | `package.json` | Remove @google/genai dependency |

### New Files (Tests)
| # | Path |
|---|---|
| 1 | `src/tests/ShramSafal.Domain.Tests/AI/AiJobTests.cs` |
| 2 | `src/tests/ShramSafal.Domain.Tests/AI/AiOrchestratorTests.cs` |
| 3 | `src/tests/ShramSafal.Domain.Tests/AI/GeminiAdapterTests.cs` |
| 4 | `src/tests/ShramSafal.Domain.Tests/AI/SarvamAdapterTests.cs` |
| 5 | `src/tests/ShramSafal.Domain.Tests/AI/AiPromptBuilderTests.cs` |
| 6 | `src/tests/ShramSafal.Sync.IntegrationTests/AiEndpointsTests.cs` |

---

## DEFINITION OF DONE

This plan is complete only when ALL of the following are true:

- [ ] `dotnet build src/AgriSync.sln` -- zero errors
- [ ] `dotnet test src/AgriSync.sln` -- all tests pass
- [ ] `cd src/clients/mobile-web && npm run build` -- zero errors
- [ ] `cd src/clients/mobile-web && npx tsc --noEmit` -- zero errors
- [ ] No `VITE_GEMINI_API_KEY` in any frontend file (except GeminiClient.ts if retained as dead code reference)
- [ ] No `@google/genai` import in any active frontend file
- [ ] `grep -r "api-subscription-key\|GEMINI_API_KEY" src/clients/mobile-web/dist/` returns NOTHING
- [ ] Backend voice parse endpoint returns valid AgriLogResponse JSON
- [ ] Backend receipt extract endpoint returns valid ReceiptExtractionResponse JSON
- [ ] Sarvam default works for Marathi audio
- [ ] Gemini fallback triggers automatically on Sarvam failure
- [ ] Idempotent retry returns cached result (no duplicate AI calls)
- [ ] Circuit breaker opens after threshold failures
- [ ] Admin can view and change provider settings
- [ ] Settings changes are audited
- [ ] Offline audio/image is queued locally and processed on reconnect
- [ ] ai_jobs and ai_job_attempts tables populated with every AI operation

---

## NOTES FOR EXECUTION

1. **DO NOT simplify the prompt.** The 700-line voice parsing prompt in `aiPrompts.ts` is the result of 25+ iterations with real Marathi farmer audio. Port it exactly.
2. **DO NOT change the AgriLogResponse schema.** Frontend depends on it. Backend must produce the same JSON.
3. **Sarvam STT returns transcript, not structured data.** The structured extraction happens in the second step (Sarvam Chat or Gemini Chat). The two-step pipeline is intentional.
4. **Gemini is a single multimodal call.** It takes audio inline and returns structured JSON directly. This is why it's simpler but less controllable for Indic languages.
5. **Financial correctness: LLMs propose, code finalizes.** Totals, tax calculations, and allocation math must be computed in backend C# code, not trusted from LLM output.
6. **Vocab learning (Phase 8.6) is deferrable.** It's a nice-to-have. Core functionality works without it.
7. **The `pendingAiJobs` Dexie table (Phase 8.9) is CRITICAL for offline resilience.** Without it, offline voice logs fail silently.
