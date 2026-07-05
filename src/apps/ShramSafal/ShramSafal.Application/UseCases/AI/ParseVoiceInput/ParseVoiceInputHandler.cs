using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.Extensions.Configuration;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.Ports.Privacy;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Privacy.Pii;

// NOTE: Microsoft.Extensions.Configuration is referenced here ONLY to read
// the flag Ai:DomainKnowledgeLayer:Enabled (default false).  This is the
// SOLE non-domain/non-ports import added by W1.P0 Batch A; it does NOT pull
// in any Infrastructure or EF dependency.

namespace ShramSafal.Application.UseCases.AI.ParseVoiceInput;

#pragma warning disable CS9113 // 'consentEnforcer' is unread — intentional per §B.12 (see comment below)
public sealed class ParseVoiceInputHandler(
    IShramSafalRepository repository,
    IAiOrchestrator aiOrchestrator,
    IAiJobRepository aiJobRepository,
    IAiPromptBuilder promptBuilder,
    IEntitlementPolicy entitlementPolicy,
    IAnalyticsWriter analytics,
    IClock clock,
    IThirdPartyPiiDetector piiDetector,
    // Voice Diary ship (voice-diary-e2e-2026-05-17 §B.12) —
    // IConsentEnforcer is added as the LAST constructor parameter to
    // preserve the diff and protect the founder-owned IEntitlementPolicy
    // line above. The current ParseVoice flow does NOT persist any
    // retained-tier voice clip directly (Transcript rows in Phase 02.3
    // are warm tier, not retained). The dedicated persist path lives in
    // PersistVoiceClipRetainedHandler which calls into IConsentEnforcer
    // explicitly. Wiring the port here keeps the AI boundary ready for
    // any future inline retained-persist call without another ctor diff.
    // CS9113 is suppressed because the parameter is deliberately
    // reserved for forward use; removing it would break the diff
    // promise the supervisor brief made and force the DI container to
    // resolve a different constructor shape.
    IConsentEnforcer consentEnforcer,
    // W1.P0 Batch A (ai-intelligence-plan-2026-06-25 Task 8) —
    // IConfiguration is injected AFTER IConsentEnforcer to minimise
    // the ctor diff and avoid any change to the IEntitlementPolicy
    // parameter.  The only value read is the flag
    // Ai:DomainKnowledgeLayer:Enabled (default false).
    // DI resolves IConfiguration automatically; no extra registration.
    IConfiguration configuration,
    // IDomainKnowledgePipelinePort allows the Application layer to
    // invoke the Infrastructure-resident DomainKnowledgePipeline
    // without a direct project reference (port pattern).  Registered
    // in ShramSafal.Infrastructure.DependencyInjection.
    IDomainKnowledgePipelinePort domainKnowledgePipeline)
{
#pragma warning restore CS9113

    // W1.P0 Batch A — flag read once at construction time.
    // Default is false: when unset the parse path is byte-identical to
    // the pre-Batch-A behaviour.
    private readonly bool _domainKnowledgeLayerEnabled =
        configuration.GetValue<bool>("Ai:DomainKnowledgeLayer:Enabled");

    // W1.P0 Batch A — held to call from ApplyTranscriptIntegrityCorrections.
    private readonly IDomainKnowledgePipelinePort _domainKnowledgePipeline = domainKnowledgePipeline;

    private static readonly Dictionary<string, int> MarathiNumberTokens = new(StringComparer.OrdinalIgnoreCase)
    {
        ["एक"] = 1,
        ["दोघांनी"] = 2,
        ["दोन"] = 2,
        ["तिघांनी"] = 3,
        ["तिघे"] = 3,
        ["तीन"] = 3,
        ["चौघांनी"] = 4,
        ["चौघे"] = 4,
        ["चार"] = 4,
        ["पाचजणांनी"] = 5,
        ["पाचजण"] = 5,
        ["पाच"] = 5,
        ["सहाजणांनी"] = 6,
        ["सहाजण"] = 6,
        ["सहा"] = 6,
        ["सात"] = 7,
        ["आठ"] = 8,
        ["नऊ"] = 9,
        ["दहा"] = 10,
    };

    public async Task<Result<VoiceParseResult>> HandleAsync(ParseVoiceInputCommand command, CancellationToken ct = default)
    {
        if (command.UserId == Guid.Empty ||
            command.FarmId == Guid.Empty)
        {
            return Result.Failure<VoiceParseResult>(ShramSafalErrors.InvalidCommand);
        }

        if (command.PlotId.HasValue && command.PlotId.Value == Guid.Empty)
        {
            return Result.Failure<VoiceParseResult>(ShramSafalErrors.InvalidCommand);
        }

        if (command.CropCycleId.HasValue && command.CropCycleId.Value == Guid.Empty)
        {
            return Result.Failure<VoiceParseResult>(ShramSafalErrors.InvalidCommand);
        }

        var transcript = command.TextTranscript?.Trim();
        var hasAudio = !string.IsNullOrWhiteSpace(command.AudioBase64);
        if (string.IsNullOrWhiteSpace(transcript) && !hasAudio)
        {
            return Result.Failure<VoiceParseResult>(ShramSafalErrors.MissingVoiceTranscript);
        }

        var farm = await repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure<VoiceParseResult>(ShramSafalErrors.FarmNotFound);
        }

        var canAccessFarm = await repository.IsUserMemberOfFarmAsync(command.FarmId, command.UserId, ct);
        if (!canAccessFarm)
        {
            return Result.Failure<VoiceParseResult>(ShramSafalErrors.Forbidden);
        }

        var gate = await EntitlementGate.CheckAsync<VoiceParseResult>(
            entitlementPolicy,
            new UserId(command.UserId),
            new FarmId(command.FarmId),
            PaidFeature.AiParse,
            ct);
        if (gate is not null)
        {
            return gate;
        }

        Domain.Farms.Plot? plot = null;
        if (command.PlotId.HasValue)
        {
            plot = await repository.GetPlotByIdAsync(command.PlotId.Value, ct);
            if (plot is null || plot.FarmId != farm.Id)
            {
                return Result.Failure<VoiceParseResult>(ShramSafalErrors.PlotNotFound);
            }
        }

        Domain.Crops.CropCycle? cropCycle = null;
        if (command.CropCycleId.HasValue)
        {
            cropCycle = await repository.GetCropCycleByIdAsync(command.CropCycleId.Value, ct);
            if (cropCycle is null || cropCycle.FarmId != farm.Id)
            {
                return Result.Failure<VoiceParseResult>(ShramSafalErrors.CropCycleNotFound);
            }

            if (plot is not null && cropCycle.PlotId != plot.Id)
            {
                return Result.Failure<VoiceParseResult>(ShramSafalErrors.CropCycleNotFound);
            }
        }

        var promptContext = BuildPromptContext(command.ContextJson, farm.Name, plot?.Name, cropCycle?.CropName, cropCycle?.Stage);
        var systemPrompt = promptBuilder.BuildVoiceParsingPrompt(promptContext);

        await using var payloadStream = BuildPayloadStream(command, transcript, out var mimeType);
        var idempotencyKey = !string.IsNullOrWhiteSpace(command.IdempotencyKey)
            ? command.IdempotencyKey!.Trim()
            : BuildIdempotencyKey(command, transcript, command.AudioBase64);

        // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.4 — feature-flag
        // route. The `voice_provider_sarvam_cohort` flag is not yet wired
        // with an Application-layer query helper (Phase 1.4 shipped the
        // FeatureFlag entity; the read-side helper is a separate slice).
        // For Slice B we route based on the legacy `voice_provider` column
        // equaling `Sarvam` — the same signal a cohort flag flip would
        // ultimately produce on AiProviderConfig.VoiceProvider. When the
        // config row says Sarvam (CreateDefault now defaults to Sarvam),
        // route through the 2-stage pipeline; otherwise stay on legacy.
        var providerConfig = await aiJobRepository.GetProviderConfigAsync(ct);
        var routeTwoStage = providerConfig.VoiceProvider == Domain.AI.AiProviderType.Sarvam;

        var stopwatch = Stopwatch.StartNew();
        try
        {
            var orchestration = routeTwoStage
                ? await aiOrchestrator.ParseVoiceTwoStageAsync(
                    command.UserId,
                    command.FarmId,
                    payloadStream,
                    mimeType,
                    promptContext,
                    idempotencyKey,
                    languageHint: "mr-IN",
                    // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder fix
                    // (Option B): thread the actual recording timestamp from
                    // the client (Dexie voice_clips.recordedAtUtc → multipart
                    // recorded_at form field → command.RecordedAtUtc) rather
                    // than clock.UtcNow. The latter is request-receipt time
                    // and produces off-by-one "काल" resolutions for evening
                    // recordings synced after midnight. When the client did
                    // not send a recorded_at value (legacy/orphan clips)
                    // this is null and the prompt substitutes "unknown".
                    capturedAtUtc: command.RecordedAtUtc,
                    inputSpeechDurationMs: command.InputSpeechDurationMs,
                    inputRawDurationMs: command.InputRawDurationMs,
                    segmentMetadataJson: command.SegmentMetadataJson,
                    requestPayloadHash: command.RequestPayloadHash,
                    clientAppVersion: string.IsNullOrWhiteSpace(command.ClientAppVersion)
                        ? "unknown"
                        : command.ClientAppVersion,
                    ct: ct)
                : await aiOrchestrator.ParseVoiceWithFallbackAsync(
                    command.UserId,
                    command.FarmId,
                    payloadStream,
                    mimeType,
                    systemPrompt,
                    idempotencyKey,
                    languageHint: "mr-IN",
                    inputSpeechDurationMs: command.InputSpeechDurationMs,
                    inputRawDurationMs: command.InputRawDurationMs,
                    segmentMetadataJson: command.SegmentMetadataJson,
                    requestPayloadHash: command.RequestPayloadHash,
                    clientAppVersion: string.IsNullOrWhiteSpace(command.ClientAppVersion)
                        ? "unknown"
                        : command.ClientAppVersion,
                    ct: ct);
            stopwatch.Stop();

            var canonicalResult = orchestration.Result;
            if (!canonicalResult.Success || string.IsNullOrWhiteSpace(canonicalResult.NormalizedJson))
            {
                await EmitAiInvocationAsync(
                    command,
                    providerUsed: orchestration.ProviderUsed.ToString(),
                    jobId: orchestration.JobId,
                    fallbackUsed: orchestration.FallbackUsed,
                    latencyMs: stopwatch.ElapsedMilliseconds,
                    success: false,
                    overallConfidence: null,
                    error: canonicalResult.Error,
                    modelUsed: canonicalResult.ModelUsed,
                    promptVersion: canonicalResult.PromptVersion,
                    validationOutcome: "provider_fail",
                    fieldConfidenceCount: null,
                    ct: ct);

                return Result.Failure<VoiceParseResult>(
                    new Error(
                        ShramSafalErrors.AiParsingFailed.Code,
                        canonicalResult.Error ?? ShramSafalErrors.AiParsingFailed.Description));
            }

            using var document = JsonDocument.Parse(
                ApplyTranscriptIntegrityCorrections(
                    canonicalResult.NormalizedJson,
                    canonicalResult.RawTranscript ?? transcript ?? string.Empty,
                    _domainKnowledgeLayerEnabled,
                    _domainKnowledgePipeline));
            var parsedLog = document.RootElement.Clone();
            var fieldConfidences = ExtractFieldConfidences(parsedLog);
            var overallConfidence = canonicalResult.OverallConfidence > 0
                ? canonicalResult.OverallConfidence
                : InferFallbackConfidence(parsedLog);
            var suggestedAction = DetermineSuggestedAction(fieldConfidences, overallConfidence);

            var providerUsed = orchestration.ProviderUsed.ToString();
            var modelUsed = string.IsNullOrWhiteSpace(canonicalResult.ModelUsed)
                ? providerUsed
                : canonicalResult.ModelUsed.Trim();

            var response = new VoiceParseResult(
                parsedLog,
                decimal.Round(ConfidenceScorePolicy.Normalize(overallConfidence), 4, MidpointRounding.AwayFromZero),
                fieldConfidences,
                suggestedAction,
                modelUsed,
                canonicalResult.PromptVersion,
                providerUsed,
                orchestration.FallbackUsed,
                0,
                "pass",
                // DATA_PRINCIPLE_SPINE sub-phase 01.4 — surface the orchestrator's
                // prompt content hash so the frontend can pass it back on Confirm
                // and CreateDailyLogHandler can stamp the same hash on the
                // resulting DailyLog's Provenance (sub-phase 01.5 wires the
                // response shape; 01.6 wires the frontend).
                PromptContentHash: canonicalResult.PromptContentHash);

            // DATA_PRINCIPLE_SPINE sub-phase 02.3 — persist the warm-tier
            // Transcript projection for the winning AiJobAttempt. Supervisor
            // amendment option B: query the AiJob for its winning attempt id
            // here rather than threading WinningAttemptId through the
            // orchestrator return tuple. One extra DB read is acceptable for
            // warm-tier persistence; keeps IAiOrchestrator's signature stable.
            //
            // TODO(Phase 03 detected-language source): currently the inbound
            // hint ("mr-IN" today, hardcoded one layer up at the orchestrator
            // call site). Swap to canonicalResult.DetectedLanguage once a
            // provider surfaces it.
            // TODO(Phase 03 token-scorer): per-token confidence is stamped
            // as an empty JSON array ("[]") until the scorer lands.
            var aiJob = await aiJobRepository.GetByIdAsync(orchestration.JobId, ct);
            var winningAttemptId = aiJob?.Attempts
                .LastOrDefault(a => a.IsSuccess)?.Id ?? Guid.Empty;
            if (winningAttemptId != Guid.Empty)
            {
                // DATA_PRINCIPLE_SPINE Phase 10 sub-phase 10.3 (OQ-5)
                // ─────────────────────────────────────────────────────
                // Run the heuristic PII detector synchronously BEFORE
                // persisting the transcript. DS-017 erasure expects
                // scrubbed transcripts at rest; an async detector would
                // leave a window where raw PII sits in the database.
                // The detector is regex-only (no Gemini call) so the
                // added latency is ~5-20ms — invisible against the
                // 1-3s Gemini parse path. Perf budget: <30ms p95.
                var rawTranscriptText = canonicalResult.RawTranscript ?? string.Empty;
                var transcriptId = Guid.NewGuid();
                var detection = await piiDetector.DetectAsync(transcriptId, rawTranscriptText, ct);

                string? textToPersist = null;
                switch (detection.Status)
                {
                    case PiiDetectionStatus.Clean:
                        textToPersist = rawTranscriptText;
                        break;
                    case PiiDetectionStatus.AutoRedacted:
                    case PiiDetectionStatus.ReviewQueue:
                        textToPersist = detection.RedactedText ?? rawTranscriptText;
                        break;
                    case PiiDetectionStatus.Discard:
                        // Drop the transcript entirely — only the queue
                        // row survives (status=Discarded) as the audit
                        // trail of the decision. No transcript persists.
                        textToPersist = null;
                        break;
                }

                if (textToPersist is not null)
                {
                    var transcriptRow = Transcript.Create(
                        aiJobId: orchestration.JobId,
                        aiJobAttemptId: winningAttemptId,
                        text: textToPersist,
                        languageTag: "mr-IN",
                        perTokenConfidenceJson: "[]");
                    // Re-stamp the deterministic transcriptId so the
                    // queue row's FK matches what we actually persist.
                    // Transcript.Create assigned a fresh Guid; we
                    // already committed our copy to the queue row
                    // below. The simplest invariant: regenerate the
                    // queue row's transcript-id reference from the
                    // transcript we just made.
                    transcriptId = transcriptRow.Id;
                    await repository.AddTranscriptAsync(transcriptRow, ct);
                }

                if (detection.Status != PiiDetectionStatus.Clean)
                {
                    var queueEntry = PiiReviewQueueEntry.FromDetection(
                        transcriptId: transcriptId,
                        originalText: rawTranscriptText,
                        detection: detection,
                        nowUtc: clock.UtcNow);
                    await repository.AddPiiReviewQueueEntryAsync(queueEntry, ct);
                }

                // Emit one AuditEvent per scan (success or null result).
                // entityType=Transcript pins the audit row to the
                // warm-tier projection; entityId is the transcript id we
                // assigned (even on discard, so the audit trail still
                // resolves consistently).
                var piiAudit = AuditEventFactory.Create(
                    entityType: "Transcript",
                    entityId: transcriptId,
                    action: "PiiScanCompleted",
                    actorUserId: command.UserId,
                    actorRole: "operator",
                    payload: new
                    {
                        score = detection.Score,
                        status = detection.Status.ToString(),
                        markerCount = detection.MarkerCount,
                        nameCount = detection.NameCount,
                        transcriptPersisted = textToPersist is not null,
                    },
                    farmId: command.FarmId,
                    clientCommandId: null,
                    appVersion: string.IsNullOrWhiteSpace(command.ClientAppVersion)
                        ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                        : command.ClientAppVersion,
                    deviceId: "voice-parse",
                    ipHash: "sha256:voice-parse",
                    sourceAiJobId: orchestration.JobId);
                await repository.AddAuditEventAsync(piiAudit, ct);
            }

            await EmitAiInvocationAsync(
                command,
                providerUsed: providerUsed,
                jobId: orchestration.JobId,
                fallbackUsed: orchestration.FallbackUsed,
                latencyMs: stopwatch.ElapsedMilliseconds,
                success: true,
                overallConfidence: response.Confidence,
                error: null,
                modelUsed: modelUsed,
                promptVersion: canonicalResult.PromptVersion,
                validationOutcome: response.ValidationOutcome,
                fieldConfidenceCount: fieldConfidences.Count,
                ct: ct);

            return Result.Success(response);
        }
        catch (Exception ex)
        {
            stopwatch.Stop();
            await EmitAiInvocationAsync(
                command,
                providerUsed: "unknown",
                jobId: Guid.Empty,
                fallbackUsed: false,
                latencyMs: stopwatch.ElapsedMilliseconds,
                success: false,
                overallConfidence: null,
                error: ex.Message,
                modelUsed: null,
                promptVersion: null,
                validationOutcome: "exception",
                fieldConfidenceCount: null,
                ct: ct);

            return Result.Failure<VoiceParseResult>(
                new Error(
                    ShramSafalErrors.AiParsingFailed.Code,
                    $"{ShramSafalErrors.AiParsingFailed.Description} {ex.Message}"));
        }
    }

    private Task EmitAiInvocationAsync(
        ParseVoiceInputCommand command,
        string providerUsed,
        Guid jobId,
        bool fallbackUsed,
        long latencyMs,
        bool success,
        decimal? overallConfidence,
        string? error,
        string? modelUsed,
        string? promptVersion,
        string? validationOutcome,
        int? fieldConfidenceCount,
        CancellationToken ct)
    {
        return analytics.EmitAsync(new AnalyticsEvent(
            EventId: Guid.NewGuid(),
            EventType: AnalyticsEventType.AiInvocation,
            OccurredAtUtc: clock.UtcNow,
            ActorUserId: new UserId(command.UserId),
            FarmId: new FarmId(command.FarmId),
            OwnerAccountId: null,
            ActorRole: "operator",
            Trigger: "voice",
            DeviceOccurredAtUtc: null,
            SchemaVersion: "v1",
            PropsJson: JsonSerializer.Serialize(new
            {
                operation = "voice.parse",
                jobId,
                providerUsed,
                fallbackUsed,
                latencyMs,
                outcome = success ? "success" : "failure",
                overallConfidence,
                modelUsed,
                promptVersion,
                validationOutcome,
                fieldConfidenceCount,
                inputSpeechDurationMs = command.InputSpeechDurationMs,
                inputRawDurationMs = command.InputRawDurationMs,
                hasAudio = !string.IsNullOrWhiteSpace(command.AudioBase64),
                hasTextTranscript = !string.IsNullOrWhiteSpace(command.TextTranscript),
                requestPayloadHashPresent = !string.IsNullOrWhiteSpace(command.RequestPayloadHash),
                error
            })
        ), ct);
    }

    private static Stream BuildPayloadStream(
        ParseVoiceInputCommand command,
        string? transcript,
        out string mimeType)
    {
        if (!string.IsNullOrWhiteSpace(command.AudioBase64))
        {
            var normalizedBase64 = command.AudioBase64!;
            var commaIndex = normalizedBase64.IndexOf(',');
            if (commaIndex >= 0 && commaIndex < normalizedBase64.Length - 1)
            {
                normalizedBase64 = normalizedBase64[(commaIndex + 1)..];
            }

            var audioBytes = Convert.FromBase64String(normalizedBase64);
            mimeType = string.IsNullOrWhiteSpace(command.AudioMimeType)
                ? "audio/webm"
                : command.AudioMimeType!.Trim();
            return new MemoryStream(audioBytes, writable: false);
        }

        var textBytes = Encoding.UTF8.GetBytes(transcript ?? string.Empty);
        mimeType = "text/plain";
        return new MemoryStream(textBytes, writable: false);
    }

    private static VoiceParseContext BuildPromptContext(
        string? contextJson,
        string farmName,
        string? plotName,
        string? cropName,
        string? cropStage = null)
    {
        if (!string.IsNullOrWhiteSpace(contextJson))
        {
            try
            {
                var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
                var parsed = JsonSerializer.Deserialize<VoiceParseContext>(contextJson, options);
                if (parsed is not null
                    && parsed.AvailableCrops is not null
                    && parsed.Profile is not null)
                {
                    // AI_INTELLIGENCE_PLAN_2026-06-25 W1.P0 C8 — when the
                    // caller supplies a cropStage from the confirmed
                    // CropCycle.Stage, inject it as a soft prior even when
                    // the full context came from the client JSON. This
                    // ensures the stage-prior block is always available in
                    // BuildFarmKnowledge regardless of which code path
                    // produced the context object.
                    if (!string.IsNullOrWhiteSpace(cropStage) && parsed.CropStage is null)
                    {
                        return parsed with { CropStage = cropStage };
                    }

                    return parsed;
                }
            }
            catch (JsonException ex)
            {
                // Sub-plan 03 Task 10: not a silent swallow — emit an
                // OTel/Activity event so the malformed-context path is
                // visible in traces. Static method has no access to
                // ILogger; Activity.Current is the standards-compliant
                // observability seam here.
                System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent(
                    "ParseVoice.MalformedContext",
                    tags: new System.Diagnostics.ActivityTagsCollection
                    {
                        ["exception.type"] = ex.GetType().Name,
                        ["exception.message"] = ex.Message,
                    }));
                // Fall through to the minimal-context fallback below.
            }
        }

        var selection = new SelectedCropContext(
            CropId: cropName ?? "unknown",
            CropName: cropName ?? "Not specified",
            SelectedPlotIds: plotName is null ? [] : [plotName],
            SelectedPlotNames: plotName is null ? [] : [plotName]);

        return new VoiceParseContext(
            AvailableCrops: [],
            Profile: new FarmerProfileInfo([], [], [], null),
            FarmContext: new FarmContextInfo([selection]),
            FocusCategory: null,
            VocabDb: null)
        {
            CropStage = cropStage,
        };
    }

    private static string BuildIdempotencyKey(
        ParseVoiceInputCommand command,
        string? transcript,
        string? audioBase64)
    {
        var input = $"{command.UserId}|{command.FarmId}|{command.PlotId}|{command.CropCycleId}|{transcript}|{audioBase64}";
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(input));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    // internal (not private) so ShramSafal.Domain.Tests can drive the REAL
    // flag-branching logic with both flag states (W1.P0 Task 8 fix, Finding 2).
    // Access widened from private → internal only; the method body and the
    // production call site are unchanged.  Guarded by InternalsVisibleTo in
    // ShramSafal.Application.csproj.
    internal static string ApplyTranscriptIntegrityCorrections(
        string normalizedJson,
        string transcript,
        bool domainKnowledgeLayerEnabled = false,
        IDomainKnowledgePipelinePort? domainKnowledgePipeline = null)
    {
        if (string.IsNullOrWhiteSpace(normalizedJson))
        {
            return normalizedJson;
        }

        JsonObject root;
        try
        {
            root = JsonNode.Parse(normalizedJson)?.AsObject() ?? new JsonObject();
        }
        catch (JsonException ex)
        {
            // Sub-plan 03 Task 10: malformed normalized JSON falls
            // through verbatim. Activity event for observability
            // (static helper; no ILogger).
            System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent(
                "ParseVoiceInput.MalformedNormalizedJson",
                tags: new System.Diagnostics.ActivityTagsCollection
                {
                    ["exception.type"] = ex.GetType().Name,
                    ["exception.message"] = ex.Message,
                }));
            return normalizedJson;
        }

        var cleanTranscript = transcript.Trim();
        if (cleanTranscript.Length == 0)
        {
            return normalizedJson;
        }

        root["fullTranscript"] = cleanTranscript;

        var labourSegments = ExtractCompoundLabourSegments(cleanTranscript);
        if (labourSegments.Count > 0)
        {
            var labour = new JsonArray();
            foreach (var segment in labourSegments)
            {
                labour.Add(new JsonObject
                {
                    ["type"] = "HIRED",
                    ["count"] = segment.Count,
                    ["activity"] = segment.Activity,
                    ["sourceText"] = segment.SourceText,
                    ["systemInterpretation"] = $"{segment.Count} मजुरांनी {segment.ActivityDisplay} काम केले"
                });
            }

            root["labour"] = labour;

            if (labourSegments.Any(segment => segment.Activity == "fertilizer_application"))
            {
                var inputs = root["inputs"] as JsonArray ?? new JsonArray();
                if (inputs.Count == 0)
                {
                    inputs.Add(new JsonObject
                    {
                        ["productName"] = "खत",
                        ["method"] = "Soil",
                        ["type"] = "fertilizer",
                        ["sourceText"] = labourSegments.First(segment => segment.Activity == "fertilizer_application").SourceText,
                        ["systemInterpretation"] = "खत टाकण्याचे काम नोंदवले"
                    });
                }
                root["inputs"] = inputs;
            }

            if (labourSegments.Any(segment => segment.Activity == "irrigation"))
            {
                var irrigation = root["irrigation"] as JsonArray ?? new JsonArray();
                if (irrigation.Count == 0)
                {
                    irrigation.Add(new JsonObject
                    {
                        ["method"] = "Flood",
                        ["sourceText"] = labourSegments.First(segment => segment.Activity == "irrigation").SourceText,
                        ["systemInterpretation"] = "पाणी सोडण्याचे काम नोंदवले"
                    });
                }
                root["irrigation"] = irrigation;
            }
        }

        if (TryExtractGenderSplit(cleanTranscript, out var maleCount, out var femaleCount))
        {
            root["labour"] = new JsonArray
            {
                new JsonObject
                {
                    ["type"] = "HIRED",
                    ["maleCount"] = maleCount,
                    ["femaleCount"] = femaleCount,
                    ["count"] = maleCount + femaleCount,
                    ["activity"] = "field_work",
                    ["sourceText"] = cleanTranscript,
                    ["systemInterpretation"] = $"{maleCount} पुरुष आणि {femaleCount} महिला मजूर कामावर होते"
                }
            };
        }

        // Safety net: ensure fertilizer application is captured when explicitly stated with a past-tense verb.
        //
        // W1.P0 Batch A (ai-intelligence-plan-2026-06-25 Task 8 fix) —
        // This ORIGINAL unguarded net runs BEFORE GrapeInputLexicon, so when the
        // domain-knowledge layer is ON it would clobber an empty inputs[] with a
        // generic productName="खत" BEFORE the lexicon could normalize a real
        // product row (the §1 CRITICAL pre-lexicon-clobber the spec forbids).
        // It is therefore gated to run ONLY when the flag is OFF:
        //   - Flag OFF (default): runs exactly as before → flag-OFF output is
        //     byte-identical to the pre-Batch-A behaviour.
        //   - Flag ON: SKIPPED here; the DEMOTED + GUARDED net inside
        //     DomainKnowledgePipeline.ApplyGuardedFertilizerSafetyNet (which runs
        //     AFTER GrapeInputLexicon and only when inputs[] is empty AND no row
        //     carries rawProductName) is the ONLY खत injection.
        if (!domainKnowledgeLayerEnabled && ContainsFertilizerApplication(cleanTranscript))
        {
            var inputs = root["inputs"] as JsonArray ?? new JsonArray();
            if (inputs.Count == 0)
            {
                inputs.Add(new JsonObject
                {
                    ["productName"] = "खत",
                    ["method"] = "Soil",
                    ["type"] = "fertilizer",
                    ["sourceText"] = cleanTranscript,
                    ["systemInterpretation"] = "खत देण्याचे काम नोंदवले"
                });
                root["inputs"] = inputs;
            }
        }

        if (ContainsIssueSignal(cleanTranscript))
        {
            var observations = root["observations"] as JsonArray ?? new JsonArray();
            if (!observations.Any(node => node?["noteType"]?.GetValue<string>() == "issue"))
            {
                observations.Add(new JsonObject
                {
                    ["noteType"] = "issue",
                    ["textRaw"] = cleanTranscript,
                    ["textCleaned"] = cleanTranscript,
                    ["severity"] = "important",
                    ["sourceText"] = cleanTranscript
                });
            }
            root["observations"] = observations;
        }

        if (ContainsFutureIntent(cleanTranscript))
        {
            var observations = root["observations"] as JsonArray ?? new JsonArray();
            var plannedTasks = root["plannedTasks"] as JsonArray ?? new JsonArray();
            if (!plannedTasks.Any())
            {
                plannedTasks.Add(new JsonObject
                {
                    ["title"] = InferReminderTitle(cleanTranscript),
                    ["dueHint"] = "उद्या",
                    ["sourceText"] = cleanTranscript
                });
            }

            if (!observations.Any(node => node?["noteType"]?.GetValue<string>() == "reminder"))
            {
                observations.Add(new JsonObject
                {
                    ["noteType"] = "reminder",
                    ["textRaw"] = cleanTranscript,
                    ["textCleaned"] = cleanTranscript,
                    ["sourceText"] = cleanTranscript
                });
            }

            root["observations"] = observations;
            root["plannedTasks"] = plannedTasks;
        }

        // W1.P0 Batch A — flag-guarded domain-knowledge pipeline.
        // When Ai:DomainKnowledgeLayer:Enabled is true (default false),
        // runs all 7 normalizers (C1–C7) in the prescribed order.
        // When false, this block is a no-op and the output is byte-identical
        // to the pre-Batch-A behaviour.
        if (domainKnowledgeLayerEnabled && domainKnowledgePipeline is not null)
        {
            // W1.P2 B002 fix — provenance stamping MUST defer to the pipeline,
            // specifically C7 ProvenanceTagger which classifies "assumed" on
            // fabricated values. Pre-stamping "spoken" before RunPipeline would
            // disarm C7: IsKnownUpstreamProvenance("spoken") returns true and
            // C7 early-returns, so assumed/derived values would remain "spoken"
            // — a honesty violation that inflates the Understanding Meter.
            //
            // Correct order:
            //   1. Snapshot which item object references exist NOW (pre-pipeline =
            //      transcript-origin). We capture the actual JsonObject instances
            //      since the root is the same tree throughout.
            //   2. Run the pipeline. C7 (LAST normalizer) authoritatively stamps
            //      "spoken", "derived", or "assumed" on quantity-bearing nodes.
            //   3. GAP-FILL only items still MISSING a provenance key after C7:
            //      - item existed pre-pipeline (reference in snapshot) → "spoken"
            //      - item added by the pipeline (NOT in snapshot)       → "derived"
            //   NEVER overwrite a provenance key already set by C7 or any
            //   upstream normalizer ("assumed" and C7's tags all survive).

            // Step 1: snapshot object references for items that exist right now.
            var preRunItemRefs = SnapshotItemRefs(root);

            // Step 2: run the pipeline (C7 stamps spoken/derived/assumed).
            domainKnowledgePipeline.RunPipeline(root, transcript);

            // Step 3: gap-fill items that C7 did not tag (non-quantity-bearing
            // nodes that have no provenance key yet).
            //   - pre-pipeline item with no provenance key → "spoken"
            //   - pipeline-added item with no provenance key → "derived"
            GapFillProvenance(root, preRunItemRefs);
        }

        return root.ToJsonString();
    }

    // W1.P2 B002 fix — provenance helpers that let C7 ProvenanceTagger win.
    //
    // Arrays walked: labour, inputs, irrigation, observations, plannedTasks,
    // cropActivities, machinery, activityExpenses (all top-level event arrays
    // that may receive items from either path).
    private static readonly string[] EventArrayKeys =
    [
        "labour", "inputs", "irrigation", "observations",
        "plannedTasks", "cropActivities", "machinery", "activityExpenses"
    ];

    /// <summary>
    /// Captures the set of <see cref="JsonObject"/> references that exist
    /// inside the known event-item arrays BEFORE the pipeline runs.
    /// Used by <see cref="GapFillProvenance"/> to distinguish transcript-origin
    /// items from pipeline-added items when doing post-pipeline gap-fill.
    /// </summary>
    private static HashSet<JsonObject> SnapshotItemRefs(JsonObject root)
    {
        var refs = new HashSet<JsonObject>(ReferenceEqualityComparer.Instance);
        foreach (var key in EventArrayKeys)
        {
            if (root[key] is not JsonArray array)
            {
                continue;
            }

            foreach (var node in array)
            {
                if (node is JsonObject item)
                {
                    refs.Add(item);
                }
            }
        }

        return refs;
    }

    /// <summary>
    /// Gap-fills provenance ONLY on items that C7 ProvenanceTagger left
    /// without a "provenance" key (i.e. non-quantity-bearing nodes that C7
    /// deliberately skips).
    /// <list type="bullet">
    ///   <item>Item existed before RunPipeline (reference in
    ///         <paramref name="preRunItemRefs"/>) → "spoken".</item>
    ///   <item>Item added by the pipeline (NOT in snapshot) → "derived".</item>
    /// </list>
    /// NEVER overwrites a key already set by C7 or any upstream normalizer.
    /// "assumed", "derived", and "spoken" tags set by C7 all survive unchanged.
    /// </summary>
    private static void GapFillProvenance(JsonObject root, HashSet<JsonObject> preRunItemRefs)
    {
        foreach (var key in EventArrayKeys)
        {
            if (root[key] is not JsonArray array)
            {
                continue;
            }

            foreach (var node in array)
            {
                if (node is not JsonObject item)
                {
                    continue;
                }

                // Never overwrite — C7's classifications must survive.
                if (item.ContainsKey("provenance"))
                {
                    continue;
                }

                var fallback = preRunItemRefs.Contains(item) ? "spoken" : "derived";
                item["provenance"] = fallback;
            }
        }
    }

    private static List<(int Count, string Activity, string ActivityDisplay, string SourceText)> ExtractCompoundLabourSegments(string transcript)
    {
        var results = new List<(int Count, string Activity, string ActivityDisplay, string SourceText)>();
        var segments = Regex.Split(transcript, @"\s+आणि\s+|,\s*|。\s*|।\s*|\.\s*")
            .Select(segment => segment.Trim())
            .Where(segment => !string.IsNullOrWhiteSpace(segment))
            .ToList();

        foreach (var segment in segments)
        {
            var count = TryExtractCount(segment);
            if (!count.HasValue)
            {
                continue;
            }

            var activity = InferLabourActivity(segment);
            if (activity is null)
            {
                continue;
            }

            results.Add((count.Value, activity.Value.Activity, activity.Value.ActivityDisplay, segment));
        }

        return results;
    }

    private static int? TryExtractCount(string value)
    {
        foreach (var token in MarathiNumberTokens.OrderByDescending(item => item.Key.Length))
        {
            if (value.Contains(token.Key, StringComparison.OrdinalIgnoreCase))
            {
                return token.Value;
            }
        }

        var digitMatch = Regex.Match(value, @"\b(\d+)\b");
        if (digitMatch.Success && int.TryParse(digitMatch.Groups[1].Value, out var parsed))
        {
            return parsed;
        }

        return null;
    }

    private static (string Activity, string ActivityDisplay)? InferLabourActivity(string value)
    {
        if (value.Contains("नांगर", StringComparison.OrdinalIgnoreCase))
        {
            return ("tillage", "नांगरणीचे");
        }

        if (value.Contains("खत", StringComparison.OrdinalIgnoreCase))
        {
            return ("fertilizer_application", "खत टाकण्याचे");
        }

        if (value.Contains("पाणी", StringComparison.OrdinalIgnoreCase) && (value.Contains("सोड", StringComparison.OrdinalIgnoreCase) || value.Contains("दिले", StringComparison.OrdinalIgnoreCase)))
        {
            return ("irrigation", "पाणी देण्याचे");
        }

        if (value.Contains("फवार", StringComparison.OrdinalIgnoreCase))
        {
            return ("spraying", "फवारणीचे");
        }

        if (value.Contains("छाट", StringComparison.OrdinalIgnoreCase))
        {
            return ("pruning", "छाटणीचे");
        }

        if (value.Contains("निंदण", StringComparison.OrdinalIgnoreCase))
        {
            return ("weeding", "निंदणीचे");
        }

        if (value.Contains("पाने", StringComparison.OrdinalIgnoreCase) && value.Contains("काढ", StringComparison.OrdinalIgnoreCase))
        {
            return ("leaf_removal", "पाने काढण्याचे");
        }

        return null;
    }

    private static bool TryExtractGenderSplit(string transcript, out int maleCount, out int femaleCount)
    {
        maleCount = 0;
        femaleCount = 0;

        var maleMatch = Regex.Match(transcript, @"(एक|दोन|तीन|चार|पाच|सहा|सात|आठ|नऊ|दहा|\d+)\s+पुरुष");
        var femaleMatch = Regex.Match(transcript, @"(एक|दोन|तीन|चार|पाच|सहा|सात|आठ|नऊ|दहा|\d+)\s+बायका");

        if (!maleMatch.Success || !femaleMatch.Success)
        {
            return false;
        }

        maleCount = TryExtractCount(maleMatch.Value) ?? 0;
        femaleCount = TryExtractCount(femaleMatch.Value) ?? 0;
        return maleCount > 0 || femaleCount > 0;
    }

    private static bool ContainsFertilizerApplication(string transcript)
    {
        return transcript.Contains("खत", StringComparison.OrdinalIgnoreCase)
               && (transcript.Contains("दिलं", StringComparison.OrdinalIgnoreCase)
                   || transcript.Contains("दिले", StringComparison.OrdinalIgnoreCase)
                   || transcript.Contains("घातले", StringComparison.OrdinalIgnoreCase)
                   || transcript.Contains("टाकले", StringComparison.OrdinalIgnoreCase));
    }

    private static bool ContainsIssueSignal(string transcript)
    {
        return transcript.Contains("पिवळी", StringComparison.OrdinalIgnoreCase)
               || transcript.Contains("किडे", StringComparison.OrdinalIgnoreCase)
               || transcript.Contains("रोग", StringComparison.OrdinalIgnoreCase)
               || transcript.Contains("समस्या", StringComparison.OrdinalIgnoreCase)
               || transcript.Contains("खराब", StringComparison.OrdinalIgnoreCase)
               || transcript.Contains("डाग", StringComparison.OrdinalIgnoreCase)
               || transcript.Contains("बंद पडली", StringComparison.OrdinalIgnoreCase)
               || transcript.Contains("नुकसान", StringComparison.OrdinalIgnoreCase);
    }

    private static bool ContainsFutureIntent(string transcript)
    {
        return transcript.Contains("उद्या", StringComparison.OrdinalIgnoreCase)
               || transcript.Contains("करायचं", StringComparison.OrdinalIgnoreCase)
               || transcript.Contains("करणार", StringComparison.OrdinalIgnoreCase)
               || transcript.Contains("आणायचं", StringComparison.OrdinalIgnoreCase)
               || transcript.Contains("द्यायचं", StringComparison.OrdinalIgnoreCase)
               || transcript.Contains("घ्यायचं", StringComparison.OrdinalIgnoreCase);
    }

    private static string InferReminderTitle(string transcript)
    {
        // Extract the sentence that contains the future intent to pick the right action
        var sentences = Regex.Split(transcript, @"[.।,]\s*")
            .Select(s => s.Trim())
            .Where(s => s.Length > 0)
            .ToList();

        var futureSentence = sentences.FirstOrDefault(s =>
            s.Contains("उद्या", StringComparison.OrdinalIgnoreCase)
            || s.Contains("करायचं", StringComparison.OrdinalIgnoreCase)
            || s.Contains("आणायचं", StringComparison.OrdinalIgnoreCase)
            || s.Contains("द्यायचं", StringComparison.OrdinalIgnoreCase)
            || s.Contains("घ्यायचं", StringComparison.OrdinalIgnoreCase)) ?? transcript;

        if (futureSentence.Contains("औषध", StringComparison.OrdinalIgnoreCase))
        {
            return "औषध आणणे";
        }

        if (futureSentence.Contains("फवार", StringComparison.OrdinalIgnoreCase))
        {
            return "फवारणी करणे";
        }

        if (futureSentence.Contains("खत", StringComparison.OrdinalIgnoreCase))
        {
            return "खत टाकणे";
        }

        if (futureSentence.Contains("पाणी", StringComparison.OrdinalIgnoreCase))
        {
            return "पाणी देणे";
        }

        if (futureSentence.Contains("मजूर", StringComparison.OrdinalIgnoreCase) || futureSentence.Contains("labour", StringComparison.OrdinalIgnoreCase))
        {
            return "मजूर बोलवणे";
        }

        return "काम करणे";
    }

    private static Dictionary<string, FieldConfidence> ExtractFieldConfidences(JsonElement parsedLog)
    {
        var result = new Dictionary<string, FieldConfidence>(StringComparer.OrdinalIgnoreCase);

        if (!parsedLog.TryGetProperty("fieldConfidences", out var fieldConfidences) ||
            fieldConfidences.ValueKind != JsonValueKind.Object)
        {
            return result;
        }

        foreach (var property in fieldConfidences.EnumerateObject())
        {
            if (property.Value.ValueKind == JsonValueKind.Number)
            {
                if (property.Value.TryGetDecimal(out var directScore))
                {
                    result[property.Name] = FieldConfidence.Create(
                        directScore,
                        bucketId: ResolveVisibleBucketId(property.Name));
                }

                continue;
            }

            if (property.Value.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var score = TryReadDecimal(property.Value, "score") ?? 0.50m;
            var reason = TryReadString(property.Value, "reason");
            var levelLabel = TryReadString(property.Value, "level");
            var bucketId = TryReadString(property.Value, "bucketId") ?? ResolveVisibleBucketId(property.Name);
            var level = ParseConfidenceLevel(levelLabel, score);
            var normalizedScore = ConfidenceScorePolicy.Normalize(score);
            result[property.Name] = new FieldConfidence(normalizedScore, level, reason, bucketId);
        }

        return result;
    }

    private static string? ResolveVisibleBucketId(string fieldPath)
    {
        if (string.IsNullOrWhiteSpace(fieldPath))
        {
            return null;
        }

        var root = fieldPath.Trim();
        var bracketIndex = root.IndexOf('[');
        if (bracketIndex >= 0)
        {
            root = root[..bracketIndex];
        }

        var dotIndex = root.IndexOf('.');
        if (dotIndex >= 0)
        {
            root = root[..dotIndex];
        }

        return root switch
        {
            "cropActivities" => "workDone",
            "irrigation" => "irrigation",
            "inputs" => "inputs",
            "labour" => "labour",
            "machinery" => "machinery",
            "activityExpenses" => "expenses",
            "plannedTasks" => "tasks",
            "observations" => "observations",
            _ => null
        };
    }

    private static decimal InferFallbackConfidence(JsonElement parsedLog)
    {
        var extractedItemsCount =
            CountArrayItems(parsedLog, "cropActivities") +
            CountArrayItems(parsedLog, "irrigation") +
            CountArrayItems(parsedLog, "labour") +
            CountArrayItems(parsedLog, "inputs") +
            CountArrayItems(parsedLog, "machinery") +
            CountArrayItems(parsedLog, "activityExpenses");

        var score = extractedItemsCount > 0 ? 0.78m : 0.58m;
        if (CountArrayItems(parsedLog, "unclearSegments") > 0)
        {
            score -= 0.10m;
        }

        if (parsedLog.TryGetProperty("dayOutcome", out var dayOutcomeElement) &&
            string.Equals(dayOutcomeElement.GetString(), "IRRELEVANT_INPUT", StringComparison.OrdinalIgnoreCase))
        {
            score = 0.90m;
        }

        return ConfidenceScorePolicy.Normalize(score);
    }

    private static string DetermineSuggestedAction(
        IReadOnlyDictionary<string, FieldConfidence> fieldConfidences,
        decimal overallConfidence)
    {
        if (fieldConfidences.Count == 0)
        {
            if (overallConfidence >= ConfidenceScorePolicy.HighThreshold)
            {
                return "auto_confirm";
            }

            if (overallConfidence >= ConfidenceScorePolicy.MediumThreshold)
            {
                return "review_flagged";
            }

            return "manual_review";
        }

        var lowCount = fieldConfidences.Values.Count(c => c.Level == ConfidenceScore.Low);
        if (lowCount >= 3 || overallConfidence < ConfidenceScorePolicy.MediumThreshold)
        {
            return "save_as_draft";
        }

        if (lowCount > 0)
        {
            return "manual_review";
        }

        if (fieldConfidences.Values.Any(c => c.Level == ConfidenceScore.Medium))
        {
            return "review_flagged";
        }

        return "auto_confirm";
    }

    private static ConfidenceScore ParseConfidenceLevel(string? levelLabel, decimal score)
    {
        if (string.IsNullOrWhiteSpace(levelLabel))
        {
            return ConfidenceScorePolicy.FromScore(score);
        }

        return levelLabel.Trim().ToUpperInvariant() switch
        {
            "HIGH" => ConfidenceScore.High,
            "MEDIUM" => ConfidenceScore.Medium,
            "LOW" => ConfidenceScore.Low,
            _ => ConfidenceScorePolicy.FromScore(score)
        };
    }

    private static decimal? TryReadDecimal(JsonElement source, string propertyName)
    {
        if (!source.TryGetProperty(propertyName, out var property))
        {
            return null;
        }

        return property.ValueKind switch
        {
            JsonValueKind.Number when property.TryGetDecimal(out var numericValue) => numericValue,
            JsonValueKind.String when decimal.TryParse(
                property.GetString(),
                NumberStyles.Float,
                CultureInfo.InvariantCulture,
                out var parsed) => parsed,
            _ => null
        };
    }

    private static string? TryReadString(JsonElement source, string propertyName)
    {
        if (!source.TryGetProperty(propertyName, out var property) || property.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return property.GetString();
    }

    private static int CountArrayItems(JsonElement source, string propertyName)
    {
        return source.TryGetProperty(propertyName, out var arrayNode) && arrayNode.ValueKind == JsonValueKind.Array
            ? arrayNode.GetArrayLength()
            : 0;
    }
}
