using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.Storage;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Storage;

namespace ShramSafal.Infrastructure.AI;

internal sealed class AiOrchestrator(
    IEnumerable<IAiProvider> providers,
    IEnumerable<ITranscriberProvider> transcribers,
    IAiJobRepository aiJobRepository,
    AiCircuitBreakerRegistry breakerRegistry,
    AiFailureClassifier failureClassifier,
    AiAttemptCostEstimator attemptCostEstimator,
    IAiPromptBuilder promptBuilder,
    IRawBlobStore blobStore,
    IShramSafalRepository shramSafalRepository,
    ILogger<AiOrchestrator> logger) : IAiOrchestrator
{
    private const int MinProviderAttempts = 1;
    private const int MaxProviderAttempts = 5;
    private const int RetryBaseDelayMs = 200;
    private const int RetryMaxDelayMs = 2000;

    // voice-rawblob-resilient-2026-06-10 — diagnostic-only bucket label for the
    // non-fatal raw-blob-store ERROR log. Mirrors RawBlobStoreOptions.BucketName's
    // default and the configured prod bucket; used solely so the swallowed PUT
    // failure is alertable by bucket. Kept as a const (not an injected option) so
    // the non-fatal hotfix does NOT change the orchestrator's constructor surface
    // (positional primary ctor — adding a param would break direct test
    // instantiation, owned by test-writer).
    private const string ColdTierBucketLabel = "agrisync-raw-ap-south-1";

    private readonly Dictionary<AiProviderType, IAiProvider> _providers = providers
        .GroupBy(x => x.ProviderType)
        .ToDictionary(x => x.Key, x => x.First());

    // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.4 — single-role
    // transcriber port lookup. Registered alongside the legacy multi-role
    // IAiProvider so SarvamStreamingSttClient (currently the only impl)
    // is resolvable by provider type for the 2-stage pipeline.
    private readonly Dictionary<AiProviderType, ITranscriberProvider> _transcribers = transcribers
        .GroupBy(x => x.ProviderType)
        .ToDictionary(x => x.Key, x => x.First());

    public async Task<(VoiceParseCanonicalResult Result, Guid JobId, AiProviderType ProviderUsed, bool FallbackUsed)> ParseVoiceWithFallbackAsync(
        Guid userId,
        Guid farmId,
        Stream audioStream,
        string mimeType,
        string systemPrompt,
        string idempotencyKey,
        string languageHint = "mr-IN",
        int? inputSpeechDurationMs = null,
        int? inputRawDurationMs = null,
        string? segmentMetadataJson = null,
        string? requestPayloadHash = null,
        string clientAppVersion = "unknown",
        CancellationToken ct = default)
    {
        var key = string.IsNullOrWhiteSpace(idempotencyKey) ? Guid.NewGuid().ToString("N") : idempotencyKey.Trim();
        var existing = await aiJobRepository.GetByIdempotencyKeyAsync(key, ct);

        // DATA_PRINCIPLE_SPINE sub-phase 01.4 — surface the assembled prompt's
        // content hash on every canonical result so handlers can stamp
        // downstream Provenance on the manual-log / cost-entry created from
        // this parse without a second prompt-builder call. Lower-case 64-hex
        // per the registry's contract.
        var promptContentHash = promptBuilder.CurrentVoicePromptContentHash;

        if (TryReturnCachedVoiceResult(existing, out var cached, promptContentHash))
        {
            return cached;
        }

        var config = await aiJobRepository.GetProviderConfigAsync(ct);
        var payload = await ReadPayloadAsync(audioStream, ct);

        // DATA_PRINCIPLE_SPINE 02-patch (cold-storage wiring) — persist raw
        // voice bytes to the cold tier BEFORE creating the AiJob so the
        // AiJob's RawInputRef is the real content-addressed SHA-256 (and not
        // null, which was the BLOCKER #1 surfaced by Codex cross-verification
        // on 2026-05-15). The ref-count entry in ssf.raw_blob_index is
        // upserted in the same logical step so a later sweep can see how
        // many AiJobs (and downstream DailyLogs / CostEntries) reference this
        // payload. The S3 PutAsync is idempotent on content, so a retry that
        // re-enters this method for the same audio bytes is a HEAD short-
        // circuit, not a double-write. The DB upsert is also idempotent:
        // first sighting inserts RefCount=1, repeat sighting increments.
        //
        // voice-rawblob-resilient-2026-06-10 — NON-FATAL: a cold-tier storage
        // failure no longer fails the farmer's voice log. On failure blobRef is
        // null → rawInputRef is null (a valid Phase-01 state) and we continue.
        var blobRef = await TryPersistRawBlobAsync(payload, mimeType, ct);

        // DATA_PRINCIPLE_SPINE sub-phase 01.4 — stamp the AiJob with real voice
        // provenance instead of the Manual("unknown") default.
        // PromptVersion carries the stable semver label "v1"; the 64-char
        // content hash lives in PromptContentHash for forensic identity
        // (Y.md §7 Option C). ModelVersion is stamped as "unknown" here and
        // replaced post-attempt via AiJob.UpdateProvenance (F3).
        //
        // W1.P2 T3 — ExtractorCodeSha: the git SHA of the extractor code is
        // not yet wired via SourceRevisionId (see TODO spec-1.7-step4).
        // Use the prompt content hash as the stable extractor identifier
        // for now — it changes whenever the prompt modules change and is
        // already the primary forensic identifier per DATA_PRINCIPLE_SPINE
        // Phase 01.  The AiPromptTemplateRegistry.CurrentVoicePromptContentHash
        // value is available here as promptContentHash.
        var voiceProvenance = new Provenance(
            source: Source.Voice,
            modelVersion: "unknown",
            promptVersion: "v1", // Y.md §7 Option C — stable label; hash lives in PromptContentHash.
            promptContentHash: promptContentHash,
            appVersion: string.IsNullOrWhiteSpace(clientAppVersion) ? "unknown" : clientAppVersion,
            extractorCodeSha: promptContentHash);

        var job = existing ?? AiJob.Create(
            Guid.NewGuid(),
            key,
            AiOperationType.VoiceToStructuredLog,
            userId,
            farmId,
            inputContentHash: requestPayloadHash,
            rawInputRef: blobRef?.Sha256,
            inputSessionMetadataJson: segmentMetadataJson,
            provenance: voiceProvenance);

        job.SetInputDurations(inputSpeechDurationMs, inputRawDurationMs);
        job.SetInputSessionMetadataJson(segmentMetadataJson);

        if (existing is null)
        {
            await aiJobRepository.AddAsync(job, ct);
        }

        if (config.IsAiProcessingDisabled)
        {
            job.MarkFailed();
            await aiJobRepository.SaveChangesAsync(ct);

            return (
                new VoiceParseCanonicalResult
                {
                    Success = false,
                    Error = "AI processing is currently disabled.",
                    PromptContentHash = promptContentHash
                },
                job.Id,
                config.GetProviderForOperation(AiOperationType.VoiceToStructuredLog),
                false);
        }

        var primary = ResolveProvider(config.GetProviderForOperation(AiOperationType.VoiceToStructuredLog), AiOperationType.VoiceToStructuredLog);
        var fallback = ResolveFallbackProvider(primary?.ProviderType, AiOperationType.VoiceToStructuredLog);

        var primaryExecution = await ExecuteVoiceAttemptWithRetriesAsync(
            job,
            primary,
            payload,
            mimeType,
            languageHint,
            systemPrompt,
            config,
            requestPayloadHash,
            ct);

        if (primaryExecution.IsSuccess)
        {
            // DATA_PRINCIPLE_SPINE sub-phase 01.4 — stamp the prompt content
            // hash on the canonical result returned to handlers.
            var resultWithHash = primaryExecution.Result with { PromptContentHash = promptContentHash };
            job.UpdateProvenance(primaryExecution.Result.ModelUsed ?? "unknown");
            job.MarkSucceeded(resultWithHash.NormalizedJson ?? "{}", primaryExecution.Attempt!);
            await aiJobRepository.SaveChangesAsync(ct);
            return (resultWithHash, job.Id, primaryExecution.ProviderUsed, false);
        }

        if (!config.FallbackEnabled ||
            fallback is null ||
            !failureClassifier.IsFallbackEligible(primaryExecution.FailureClass))
        {
            job.MarkFailed();
            await aiJobRepository.SaveChangesAsync(ct);
            return (primaryExecution.Result with { PromptContentHash = promptContentHash }, job.Id, primaryExecution.ProviderUsed, false);
        }

        var fallbackExecution = await ExecuteVoiceAttemptWithRetriesAsync(
            job,
            fallback,
            payload,
            mimeType,
            languageHint,
            systemPrompt,
            config,
            requestPayloadHash,
            ct);

        if (fallbackExecution.IsSuccess)
        {
            var resultWithHash = fallbackExecution.Result with { PromptContentHash = promptContentHash };
            job.UpdateProvenance(fallbackExecution.Result.ModelUsed ?? "unknown");
            job.MarkFallbackSucceeded(resultWithHash.NormalizedJson ?? "{}", fallbackExecution.Attempt!);
            await aiJobRepository.SaveChangesAsync(ct);
            return (resultWithHash, job.Id, fallbackExecution.ProviderUsed, true);
        }

        job.MarkFailed();
        await aiJobRepository.SaveChangesAsync(ct);
        return (fallbackExecution.Result with { PromptContentHash = promptContentHash }, job.Id, fallbackExecution.ProviderUsed, true);
    }

    // ── SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.4 ─────────────────
    // 2-stage voice pipeline (transcribe → structure). Resolves the
    // (transcriber, structurer) tuple from AiProviderConfig; falls back to
    // the legacy single-call multimodal path when (a) the tuple collapses
    // to one provider, (b) no transcriber is registered, or (c) the
    // transcriber step fails in a fallback-eligible way.
    //
    // Idempotency, AiJob persistence, blob upload, and Provenance stamping
    // mirror ParseVoiceWithFallbackAsync — this method exists ALONGSIDE the
    // legacy path, NOT as a replacement, per the Slice B brief.
    public async Task<(VoiceParseCanonicalResult Result, Guid JobId, AiProviderType ProviderUsed, bool FallbackUsed)> ParseVoiceTwoStageAsync(
        Guid userId,
        Guid farmId,
        Stream audioStream,
        string mimeType,
        VoiceParseContext promptContext,
        string idempotencyKey,
        string languageHint = "mr-IN",
        DateTime? capturedAtUtc = null,
        int? inputSpeechDurationMs = null,
        int? inputRawDurationMs = null,
        string? segmentMetadataJson = null,
        string? requestPayloadHash = null,
        string clientAppVersion = "unknown",
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(promptContext);

        var promptContextWithCapture = promptContext with { CapturedAtUtc = capturedAtUtc };
        var systemPrompt = promptBuilder.BuildVoiceParsingPrompt(promptContextWithCapture);

        // Resolve provider tuple. If the transcriber column equals the
        // structurer column, OR no ITranscriberProvider is registered for
        // the requested transcriber, fall back to the legacy single-call
        // multimodal path so the AiJob still lands on the same idempotency
        // row.
        var config = await aiJobRepository.GetProviderConfigAsync(ct);
        var transcriberType = ParseProviderTypeOrDefault(config.TranscriberProvider, AiProviderType.Gemini);
        var structurerType = ParseProviderTypeOrDefault(config.StructurerProvider, AiProviderType.Gemini);

        if (transcriberType == structurerType ||
            !_transcribers.TryGetValue(transcriberType, out var transcriber))
        {
            // Tuple collapses to a single provider OR transcriber port is
            // not wired — delegate to the legacy multimodal one-call path.
            return await ParseVoiceWithFallbackAsync(
                userId,
                farmId,
                audioStream,
                mimeType,
                systemPrompt,
                idempotencyKey,
                languageHint,
                inputSpeechDurationMs,
                inputRawDurationMs,
                segmentMetadataJson,
                requestPayloadHash,
                clientAppVersion,
                ct);
        }

        var key = string.IsNullOrWhiteSpace(idempotencyKey) ? Guid.NewGuid().ToString("N") : idempotencyKey.Trim();
        var existing = await aiJobRepository.GetByIdempotencyKeyAsync(key, ct);
        var promptContentHash = promptBuilder.CurrentVoicePromptContentHash;

        if (TryReturnCachedVoiceResult(existing, out var cached, promptContentHash))
        {
            return cached;
        }

        var payload = await ReadPayloadAsync(audioStream, ct);

        // Mirror ParseVoiceWithFallbackAsync's cold-tier wiring (sub-phase
        // 02-patch) so the AiJob's RawInputRef is a real content-addressed
        // SHA-256 and ref counts on raw_blob_index stay consistent.
        //
        // voice-rawblob-resilient-2026-06-10 — NON-FATAL (see helper): a
        // cold-tier storage failure leaves blobRef null → rawInputRef null,
        // and the two-stage parse still proceeds.
        var blobRef = await TryPersistRawBlobAsync(payload, mimeType, ct);

        // W1.P2 T3 — ExtractorCodeSha stamped with promptContentHash (same
        // rationale as the one-stage path above: SourceRevisionId not yet wired).
        var voiceProvenance = new Provenance(
            source: Source.Voice,
            modelVersion: "unknown",
            promptVersion: "v1",
            promptContentHash: promptContentHash,
            appVersion: string.IsNullOrWhiteSpace(clientAppVersion) ? "unknown" : clientAppVersion,
            extractorCodeSha: promptContentHash);

        var job = existing ?? AiJob.Create(
            Guid.NewGuid(),
            key,
            AiOperationType.VoiceToStructuredLog,
            userId,
            farmId,
            inputContentHash: requestPayloadHash,
            rawInputRef: blobRef?.Sha256,
            inputSessionMetadataJson: segmentMetadataJson,
            provenance: voiceProvenance);

        job.SetInputDurations(inputSpeechDurationMs, inputRawDurationMs);
        job.SetInputSessionMetadataJson(segmentMetadataJson);

        if (existing is null)
        {
            await aiJobRepository.AddAsync(job, ct);
        }

        if (config.IsAiProcessingDisabled)
        {
            job.MarkFailed();
            await aiJobRepository.SaveChangesAsync(ct);
            return (
                new VoiceParseCanonicalResult
                {
                    Success = false,
                    Error = "AI processing is currently disabled.",
                    PromptContentHash = promptContentHash
                },
                job.Id,
                transcriberType,
                false);
        }

        // ─── Stage 1: transcribe via ITranscriberProvider ───────────────
        TranscribeResult transcribeResult;
        var transcribeMode = string.IsNullOrWhiteSpace(config.TranscriberMode) ? "codemix" : config.TranscriberMode!;
        try
        {
            await using var transcribeStream = new MemoryStream(payload, writable: false);
            transcribeResult = await transcriber.TranscribeAsync(
                transcribeStream,
                mimeType,
                languageHint,
                transcribeMode,
                ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(
                ex,
                "[parse-voice-two-stage] transcribe failed for job {JobId} (provider={Transcriber}). Falling back to legacy multimodal path.",
                job.Id,
                transcriberType);

            // Transcriber failure → fall back to the legacy single-call
            // multimodal path. The AiJob has already been persisted with
            // the cold-tier blob ref; the legacy path will resolve the
            // same idempotency key and append a new attempt to this row
            // rather than creating a duplicate.
            return await ParseVoiceWithFallbackAsync(
                userId,
                farmId,
                new MemoryStream(payload, writable: false),
                mimeType,
                systemPrompt,
                key,
                languageHint,
                inputSpeechDurationMs,
                inputRawDurationMs,
                segmentMetadataJson,
                requestPayloadHash,
                clientAppVersion,
                ct);
        }

        if (!transcribeResult.Success || string.IsNullOrWhiteSpace(transcribeResult.Transcript))
        {
            var transcriptCandidate = transcribeResult.Transcript;
            var failureClass = failureClassifier.ClassifySarvamFailure(
                httpStatusCode: null,
                exception: null,
                transcript: transcriptCandidate,
                firstTokenTimedOut: false);

            logger.LogWarning(
                "[parse-voice-two-stage] transcribe returned no transcript for job {JobId} (provider={Transcriber}, failureClass={FailureClass}). Falling back.",
                job.Id,
                transcriberType,
                failureClass);

            if (config.FallbackEnabled && failureClassifier.IsFallbackEligible(failureClass))
            {
                return await ParseVoiceWithFallbackAsync(
                    userId,
                    farmId,
                    new MemoryStream(payload, writable: false),
                    mimeType,
                    systemPrompt,
                    key,
                    languageHint,
                    inputSpeechDurationMs,
                    inputRawDurationMs,
                    segmentMetadataJson,
                    requestPayloadHash,
                    clientAppVersion,
                    ct);
            }

            job.MarkFailed();
            await aiJobRepository.SaveChangesAsync(ct);
            return (
                new VoiceParseCanonicalResult
                {
                    Success = false,
                    Error = transcribeResult.Error ?? "Transcribe returned empty transcript.",
                    PromptContentHash = promptContentHash
                },
                job.Id,
                transcriberType,
                false);
        }

        // Stamp the transcript on the AiJob (Task 1.1 mutator) BEFORE the
        // structurer call so a structurer failure still leaves the raw
        // transcript persisted for audit + replay.
        job.SetTranscriptResults(
            codemix: transcribeResult.Transcript,
            english: null,
            englishRedacted: null,
            verbatim: null,
            translit: null,
            translate: null,
            transcriptProvider: transcriberType.ToString(),
            transcriptModelVersion: string.IsNullOrWhiteSpace(transcribeResult.ProviderModelVersion)
                ? "unknown"
                : transcribeResult.ProviderModelVersion!);

        // ─── Stage 2: structure via legacy IAiProvider.ParseVoiceAsync ─
        // The structurer adapter (Gemini today) does not yet implement
        // IStructurerProvider — Phase 1 wired the port but Phase 2 adapter
        // migration is its own slice. We route the transcript through
        // IAiProvider.ParseVoiceAsync with mime=text/plain so the existing
        // Gemini text-completion path handles the structure step. Mirrors
        // the eval-only ParseVoiceWithOverrideAsync flow on lines 359-428.
        var structurer = ResolveProvider(structurerType, AiOperationType.VoiceToStructuredLog);
        if (structurer is null)
        {
            logger.LogWarning(
                "[parse-voice-two-stage] no structurer registered for type {Structurer}; falling back to legacy path for job {JobId}.",
                structurerType,
                job.Id);
            return await ParseVoiceWithFallbackAsync(
                userId,
                farmId,
                new MemoryStream(payload, writable: false),
                mimeType,
                systemPrompt,
                key,
                languageHint,
                inputSpeechDurationMs,
                inputRawDurationMs,
                segmentMetadataJson,
                requestPayloadHash,
                clientAppVersion,
                ct);
        }

        var transcriptBytes = Encoding.UTF8.GetBytes(transcribeResult.Transcript!);
        var structurerExecution = await ExecuteVoiceAttemptWithRetriesAsync(
            job,
            structurer,
            transcriptBytes,
            mimeType: "text/plain",
            languageHint,
            systemPrompt,
            config,
            requestPayloadHash,
            ct);

        if (structurerExecution.IsSuccess)
        {
            var resultWithHash = structurerExecution.Result with
            {
                PromptContentHash = promptContentHash,
                TranscriptCodemix = transcribeResult.Transcript,
                TranscriptProvider = transcriberType.ToString(),
                TranscriptModelVersion = transcribeResult.ProviderModelVersion,
            };

            // Map structurer-emitted referenced_date triple onto the
            // AiJob via the Task 1.1 mutator. Best-effort: malformed JSON
            // / missing fields leave ReferencedDate null without aborting
            // the success path.
            TryStampReferencedDate(job, structurerExecution.Result.NormalizedJson);

            job.UpdateProvenance(structurerExecution.Result.ModelUsed ?? "unknown");
            job.MarkSucceeded(resultWithHash.NormalizedJson ?? "{}", structurerExecution.Attempt!);
            await aiJobRepository.SaveChangesAsync(ct);
            return (resultWithHash, job.Id, structurerExecution.ProviderUsed, false);
        }

        // Structurer failed: fall back the STRUCTURER step only. We
        // route to the legacy multimodal path (single-call audio →
        // JSON) so the model can re-do both stages — this is the safest
        // backstop because we don't yet have a sibling structurer that
        // can take text-in and return AgriLog JSON-out with the same
        // confidence semantics.
        if (config.FallbackEnabled && failureClassifier.IsFallbackEligible(structurerExecution.FailureClass))
        {
            logger.LogWarning(
                "[parse-voice-two-stage] structurer failed for job {JobId} (failureClass={FailureClass}); falling back to legacy multimodal.",
                job.Id,
                structurerExecution.FailureClass);
            return await ParseVoiceWithFallbackAsync(
                userId,
                farmId,
                new MemoryStream(payload, writable: false),
                mimeType,
                systemPrompt,
                key,
                languageHint,
                inputSpeechDurationMs,
                inputRawDurationMs,
                segmentMetadataJson,
                requestPayloadHash,
                clientAppVersion,
                ct);
        }

        job.MarkFailed();
        await aiJobRepository.SaveChangesAsync(ct);
        return (
            structurerExecution.Result with { PromptContentHash = promptContentHash, TranscriptCodemix = transcribeResult.Transcript },
            job.Id,
            structurerExecution.ProviderUsed,
            false);
    }

    private static AiProviderType ParseProviderTypeOrDefault(string? raw, AiProviderType fallback)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return fallback;
        }

        return Enum.TryParse<AiProviderType>(raw.Trim(), ignoreCase: true, out var parsed)
            ? parsed
            : fallback;
    }

    private static void TryStampReferencedDate(AiJob job, string? normalizedJson)
    {
        if (string.IsNullOrWhiteSpace(normalizedJson))
        {
            return;
        }

        try
        {
            using var document = JsonDocument.Parse(normalizedJson);
            var root = document.RootElement;

            DateOnly? referencedDate = null;
            if (root.TryGetProperty("referenced_date", out var referencedDateNode) &&
                referencedDateNode.ValueKind == JsonValueKind.String &&
                DateOnly.TryParse(referencedDateNode.GetString(), out var parsedDate))
            {
                referencedDate = parsedDate;
            }

            decimal? confidence = null;
            if (root.TryGetProperty("referenced_date_confidence", out var confidenceNode) &&
                confidenceNode.ValueKind == JsonValueKind.Number &&
                confidenceNode.TryGetDecimal(out var parsedConfidence))
            {
                confidence = parsedConfidence;
            }

            string? reason = null;
            if (root.TryGetProperty("referenced_date_reason", out var reasonNode) &&
                reasonNode.ValueKind == JsonValueKind.String)
            {
                reason = reasonNode.GetString();
            }

            // Only invoke the mutator if at least one signal was present;
            // a no-signal call would clobber any earlier inference.
            if (referencedDate is not null || confidence is not null || reason is not null)
            {
                job.SetReferencedDate(referencedDate, confidence, reason);
            }
        }
        catch (JsonException ex)
        {
            // Malformed normalized JSON is a structurer-side issue, not a
            // fatal orchestrator error — the success path already returned
            // the row; we just don't get a referenced-date stamp.
            System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent(
                "AiOrchestrator.TryStampReferencedDate.MalformedJson",
                tags: new System.Diagnostics.ActivityTagsCollection
                {
                    ["exception.type"] = ex.GetType().Name,
                    ["exception.message"] = ex.Message,
                }));
        }
    }

    // Phase 3 (VOICE_LATENCY_PIPELINE_V2 §7 Task 3.4) — streaming voice parse.
    // Mirrors the lean override path: no AiJob persistence, no idempotency,
    // no breaker bookkeeping. Pipes provider text chunks through
    // PartialJsonParser; relays text/field_complete/complete/error events to
    // the SSE endpoint.
    public async IAsyncEnumerable<ParseStreamEvent> ParseVoiceStreamAsync(
        string transcript,
        VoiceParseContext context,
        string? scenarioId,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        var prompt = promptBuilder.BuildVoiceParsingPrompt(context);
        var promptVersion = AiPromptLineage.ResolvePromptVersion(prompt);
        var config = await aiJobRepository.GetProviderConfigAsync(ct);

        if (config.IsAiProcessingDisabled)
        {
            yield return new ParseStreamEvent(
                Type: "error",
                Error: "AI processing is currently disabled.",
                PromptVersion: promptVersion);
            yield break;
        }

        var provider = ResolveVoiceStructurerProvider(config);

        if (provider is null)
        {
            yield return new ParseStreamEvent(
                Type: "error",
                Error: "No AI provider is configured for voice parsing.",
                PromptVersion: promptVersion);
            yield break;
        }

        var parser = new PartialJsonParser();
        var pendingEvents = new Queue<ParseStreamEvent>();
        parser.OnEvent += evt =>
        {
            switch (evt.Type)
            {
                case PartialJsonEventType.FieldComplete:
                    pendingEvents.Enqueue(new ParseStreamEvent(
                        Type: "field_complete",
                        FieldPath: evt.FieldPath,
                        PromptVersion: promptVersion));
                    break;
                case PartialJsonEventType.Complete:
                    pendingEvents.Enqueue(new ParseStreamEvent(
                        Type: "complete",
                        Payload: evt.Value.HasValue ? (object)evt.Value.Value : null,
                        PromptVersion: promptVersion));
                    break;
            }
        };

        var sw = Stopwatch.StartNew();
        IAsyncEnumerator<string>? enumerator = null;
        ParseStreamEvent? initError = null;
        try
        {
            enumerator = provider.ParseVoiceStreamAsync(transcript ?? string.Empty, prompt, ct).GetAsyncEnumerator(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            sw.Stop();
            logger.LogWarning(
                ex,
                "[parse-voice-stream] provider initialization failed scenario={ScenarioId} provider={Provider}",
                scenarioId ?? "<none>",
                provider.ProviderType);
            initError = new ParseStreamEvent(
                Type: "error",
                Error: ex.Message,
                PromptVersion: promptVersion,
                ModelMs: sw.ElapsedMilliseconds);
        }

        if (initError is not null)
        {
            yield return initError;
            yield break;
        }

        try
        {
            while (true)
            {
                bool hasNext;
                string? chunk = null;
                ParseStreamEvent? chunkError = null;
                try
                {
                    hasNext = await enumerator!.MoveNextAsync();
                    if (hasNext)
                    {
                        chunk = enumerator.Current;
                    }
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    sw.Stop();
                    logger.LogWarning(
                        ex,
                        "[parse-voice-stream] provider stream errored scenario={ScenarioId} provider={Provider} ms={Ms}",
                        scenarioId ?? "<none>",
                        provider.ProviderType,
                        sw.ElapsedMilliseconds);
                    chunkError = new ParseStreamEvent(
                        Type: "error",
                        Error: ex.Message,
                        PromptVersion: promptVersion,
                        ModelMs: sw.ElapsedMilliseconds);
                    hasNext = false;
                }

                if (chunkError is not null)
                {
                    yield return chunkError;
                    yield break;
                }

                if (!hasNext)
                {
                    break;
                }

                if (string.IsNullOrEmpty(chunk))
                {
                    continue;
                }

                yield return new ParseStreamEvent(
                    Type: "text",
                    Content: chunk,
                    PromptVersion: promptVersion);

                parser.Feed(chunk);

                while (pendingEvents.Count > 0)
                {
                    yield return pendingEvents.Dequeue();
                }
            }

            sw.Stop();
            logger.LogInformation(
                "[parse-voice-stream] scenario={ScenarioId} provider={Provider} version={PromptVersion} ms={Ms}",
                scenarioId ?? "<none>",
                provider.ProviderType,
                promptVersion,
                sw.ElapsedMilliseconds);
        }
        finally
        {
            if (enumerator is not null)
            {
                await enumerator.DisposeAsync();
            }
        }
    }

    // agrisync-prompt-ops Phase 1 — Lean staging path. No AiJob writes, no
    // idempotency cache, no circuit breaker. Builds the prompt (or uses an
    // override from PromptStaging), pipes the transcript as text/plain to the
    // primary provider, and returns the raw normalized JSON. The endpoint that
    // exposes this is registered only when ASPNETCORE_ENVIRONMENT != Production
    // and ALLOW_EVAL_PARSE=true (see AiEvalEndpoints).
    public async Task<EvalParseResult> ParseVoiceWithOverrideAsync(
        string transcript,
        VoiceParseContext context,
        string? promptOverride,
        string? scenarioId,
        CancellationToken ct = default)
    {
        var prompt = string.IsNullOrEmpty(promptOverride)
            ? promptBuilder.BuildVoiceParsingPrompt(context)
            : promptOverride;

        var promptVersion = AiPromptLineage.ResolvePromptVersion(prompt);
        var config = await aiJobRepository.GetProviderConfigAsync(ct);
        var provider = ResolveVoiceStructurerProvider(config);

        if (provider is null)
        {
            return new EvalParseResult(
                ParsedJson: "{}",
                PromptVersion: promptVersion,
                ModelMs: 0,
                Success: false,
                Error: "No AI provider is configured for voice parsing.");
        }

        var transcriptBytes = Encoding.UTF8.GetBytes(transcript ?? string.Empty);
        await using var transcriptStream = new MemoryStream(transcriptBytes, writable: false);

        var sw = Stopwatch.StartNew();
        try
        {
            var result = await provider.ParseVoiceAsync(
                transcriptStream,
                mimeType: "text/plain",
                languageHint: "mr-IN",
                systemPrompt: prompt,
                ct);
            sw.Stop();

            logger.LogInformation(
                "[eval-parse] scenario={ScenarioId} provider={Provider} version={PromptVersion} success={Success} ms={Ms}",
                scenarioId ?? "<unspecified>",
                provider.ProviderType,
                promptVersion,
                result.Success,
                sw.ElapsedMilliseconds);

            return new EvalParseResult(
                ParsedJson: result.NormalizedJson ?? "{}",
                PromptVersion: result.PromptVersion ?? promptVersion,
                ModelMs: sw.ElapsedMilliseconds,
                Success: result.Success,
                Error: result.Error);
        }
        catch (Exception ex)
        {
            sw.Stop();
            logger.LogWarning(
                ex,
                "[eval-parse] scenario={ScenarioId} provider threw after {Ms}ms",
                scenarioId ?? "<unspecified>",
                sw.ElapsedMilliseconds);
            return new EvalParseResult(
                ParsedJson: "{}",
                PromptVersion: promptVersion,
                ModelMs: sw.ElapsedMilliseconds,
                Success: false,
                Error: ex.Message);
        }
    }

    public async Task<(ReceiptExtractCanonicalResult Result, Guid JobId, AiProviderType ProviderUsed, bool FallbackUsed)> ExtractReceiptWithFallbackAsync(
        Guid userId,
        Guid farmId,
        Stream imageStream,
        string mimeType,
        string systemPrompt,
        string idempotencyKey,
        string clientAppVersion = "unknown",
        CancellationToken ct = default)
    {
        return await ExecuteReceiptLikeAsync(
            AiOperationType.ReceiptToExpenseItems,
            userId,
            farmId,
            imageStream,
            mimeType,
            systemPrompt,
            idempotencyKey,
            providerCall: static (provider, stream, streamMimeType, prompt, token) =>
                provider.ExtractReceiptAsync(stream, streamMimeType, prompt, token),
            clientAppVersion,
            ct);
    }

    public async Task<(ReceiptExtractCanonicalResult Result, Guid JobId, AiProviderType ProviderUsed, bool FallbackUsed)> ExtractPattiWithFallbackAsync(
        Guid userId,
        Guid farmId,
        Stream imageStream,
        string mimeType,
        string systemPrompt,
        string idempotencyKey,
        string clientAppVersion = "unknown",
        CancellationToken ct = default)
    {
        return await ExecuteReceiptLikeAsync(
            AiOperationType.PattiImageToSaleData,
            userId,
            farmId,
            imageStream,
            mimeType,
            systemPrompt,
            idempotencyKey,
            providerCall: static (provider, stream, streamMimeType, prompt, token) =>
                provider.ExtractPattiAsync(stream, streamMimeType, prompt, token),
            clientAppVersion,
            ct);
    }

    private async Task<(ReceiptExtractCanonicalResult Result, Guid JobId, AiProviderType ProviderUsed, bool FallbackUsed)> ExecuteReceiptLikeAsync(
        AiOperationType operation,
        Guid userId,
        Guid farmId,
        Stream payloadStream,
        string mimeType,
        string systemPrompt,
        string idempotencyKey,
        Func<IAiProvider, Stream, string, string, CancellationToken, Task<ReceiptExtractCanonicalResult>> providerCall,
        string clientAppVersion,
        CancellationToken ct)
    {
        var key = string.IsNullOrWhiteSpace(idempotencyKey) ? Guid.NewGuid().ToString("N") : idempotencyKey.Trim();
        var existing = await aiJobRepository.GetByIdempotencyKeyAsync(key, ct);
        if (existing is not null &&
            existing.Status is AiJobStatus.Succeeded or AiJobStatus.FallbackSucceeded &&
            !string.IsNullOrWhiteSpace(existing.NormalizedResultJson) &&
            !IsEmptyJsonObject(existing.NormalizedResultJson))
        {
            var cachedConfidence =
                TryReadJsonDecimal(existing.NormalizedResultJson, "confidence") ??
                existing.Attempts.LastOrDefault(x => x.IsSuccess)?.ConfidenceScore ??
                0.70m;

            return (
                new ReceiptExtractCanonicalResult
                {
                    Success = true,
                    NormalizedJson = existing.NormalizedResultJson,
                    OverallConfidence = cachedConfidence
                },
                existing.Id,
                existing.Attempts.LastOrDefault(x => x.IsSuccess)?.Provider ?? AiProviderType.Gemini,
                existing.Status == AiJobStatus.FallbackSucceeded);
        }

        var config = await aiJobRepository.GetProviderConfigAsync(ct);
        var payload = await ReadPayloadAsync(payloadStream, ct);

        // DATA_PRINCIPLE_SPINE 02-patch (cold-storage wiring) — receipt/patti
        // images are first-class raw evidence too. Founder decision
        // 2026-05-15: both paths persist their input bytes to the cold tier
        // (was: voice-only). Same idempotent PUT + ref-counted index pattern
        // the voice path uses above; see that comment for the rationale.
        //
        // voice-rawblob-resilient-2026-06-10 — NON-FATAL (see helper): the
        // receipt/patti raw-evidence PUT goes through the same AWSSDK.S3 v4
        // client that fails SignatureDoesNotMatch on prod, so it gets the same
        // resilience — a storage failure no longer fails the OCR extraction.
        var blobRef = await TryPersistRawBlobAsync(payload, mimeType, ct);

        // Codex cross-verification 2026-05-15 MAJOR-2: stamp real provenance
        // on the receipt/patti AiJob at creation. Was: null (falls back to
        // Provenance.Manual("unknown")). Source maps from operation.
        // ModelVersion stays "unknown" pre-attempt and is replaced post-
        // attempt via UpdateProvenance (same F3 pattern as the voice path).
        var receiptProvenance = new Provenance(
            source: operation == AiOperationType.PattiImageToSaleData
                ? Source.PattiOcr
                : Source.ReceiptOcr,
            modelVersion: "unknown",
            promptVersion: "v1",
            promptContentHash: null,
            appVersion: string.IsNullOrWhiteSpace(clientAppVersion) ? "unknown" : clientAppVersion);

        var job = existing ?? AiJob.Create(
            Guid.NewGuid(),
            key,
            operation,
            userId,
            farmId,
            inputContentHash: null,
            rawInputRef: blobRef?.Sha256,
            inputSessionMetadataJson: null,
            provenance: receiptProvenance);

        if (existing is null)
        {
            await aiJobRepository.AddAsync(job, ct);
        }

        if (config.IsAiProcessingDisabled)
        {
            job.MarkFailed();
            await aiJobRepository.SaveChangesAsync(ct);

            return (
                new ReceiptExtractCanonicalResult
                {
                    Success = false,
                    Error = "AI processing is currently disabled."
                },
                job.Id,
                config.GetProviderForOperation(operation),
                false);
        }

        var primary = ResolveProvider(config.GetProviderForOperation(operation), operation);
        var fallback = ResolveFallbackProvider(primary?.ProviderType, operation);

        var primaryExecution = await ExecuteReceiptAttemptWithRetriesAsync(
            operation,
            job,
            primary,
            payload,
            mimeType,
            systemPrompt,
            config,
            requestPayloadHash: null,
            providerCall,
            ct);

        if (primaryExecution.IsSuccess)
        {
            // F3 parity for receipt/patti: stamp the real provider model
            // before MarkSucceeded so Provenance.ModelVersion stops being
            // "unknown" on the AiJob row. Codex 2026-05-15 MAJOR-2 follow-up.
            job.UpdateProvenance(primaryExecution.Result.ModelUsed ?? "unknown");
            job.MarkSucceeded(primaryExecution.Result.NormalizedJson ?? "{}", primaryExecution.Attempt!);
            await aiJobRepository.SaveChangesAsync(ct);
            return (primaryExecution.Result, job.Id, primaryExecution.ProviderUsed, false);
        }

        if (!config.FallbackEnabled ||
            fallback is null ||
            !failureClassifier.IsFallbackEligible(primaryExecution.FailureClass))
        {
            job.MarkFailed();
            await aiJobRepository.SaveChangesAsync(ct);
            return (primaryExecution.Result, job.Id, primaryExecution.ProviderUsed, false);
        }

        var fallbackExecution = await ExecuteReceiptAttemptWithRetriesAsync(
            operation,
            job,
            fallback,
            payload,
            mimeType,
            systemPrompt,
            config,
            requestPayloadHash: null,
            providerCall,
            ct);

        if (fallbackExecution.IsSuccess)
        {
            // F3 parity (fallback path): see primary-path comment above.
            job.UpdateProvenance(fallbackExecution.Result.ModelUsed ?? "unknown");
            job.MarkFallbackSucceeded(fallbackExecution.Result.NormalizedJson ?? "{}", fallbackExecution.Attempt!);
            await aiJobRepository.SaveChangesAsync(ct);
            return (fallbackExecution.Result, job.Id, fallbackExecution.ProviderUsed, true);
        }

        job.MarkFailed();
        await aiJobRepository.SaveChangesAsync(ct);
        return (fallbackExecution.Result, job.Id, fallbackExecution.ProviderUsed, true);
    }

    private async Task<VoiceAttemptExecution> ExecuteVoiceAttemptWithRetriesAsync(
        AiJob job,
        IAiProvider? provider,
        byte[] payload,
        string mimeType,
        string languageHint,
        string systemPrompt,
        AiProviderConfig config,
        string? requestPayloadHash,
        CancellationToken ct)
    {
        var maxAttempts = ResolveMaxAttemptsPerProvider(config.MaxRetries);
        VoiceAttemptExecution? lastFailure = null;

        for (var attemptIndex = 1; attemptIndex <= maxAttempts; attemptIndex++)
        {
            ct.ThrowIfCancellationRequested();

            var execution = await ExecuteVoiceAttemptAsync(
                job,
                provider,
                payload,
                mimeType,
                languageHint,
                systemPrompt,
                config,
                requestPayloadHash,
                ct);

            if (execution.IsSuccess)
            {
                return execution;
            }

            lastFailure = execution;
            if (attemptIndex >= maxAttempts || !failureClassifier.IsRetryEligible(execution.FailureClass))
            {
                break;
            }

            var retryDelay = GetRetryDelay(attemptIndex);
            logger.LogInformation(
                "Retrying AI voice operation for job {JobId}, provider {Provider}, attempt {AttemptIndex}/{MaxAttempts} after {DelayMs}ms (failure class: {FailureClass}).",
                job.Id,
                execution.ProviderUsed,
                attemptIndex + 1,
                maxAttempts,
                retryDelay.TotalMilliseconds,
                execution.FailureClass);

            await Task.Delay(retryDelay, ct);
        }

        return lastFailure ?? VoiceAttemptExecution.Failed(
            provider?.ProviderType ?? AiProviderType.Gemini,
            AiFailureClass.TransientFailure,
            "Provider execution failed.");
    }

    private async Task<ReceiptAttemptExecution> ExecuteReceiptAttemptWithRetriesAsync(
        AiOperationType operation,
        AiJob job,
        IAiProvider? provider,
        byte[] payload,
        string mimeType,
        string systemPrompt,
        AiProviderConfig config,
        string? requestPayloadHash,
        Func<IAiProvider, Stream, string, string, CancellationToken, Task<ReceiptExtractCanonicalResult>> providerCall,
        CancellationToken ct)
    {
        var maxAttempts = ResolveMaxAttemptsPerProvider(config.MaxRetries);
        ReceiptAttemptExecution? lastFailure = null;

        for (var attemptIndex = 1; attemptIndex <= maxAttempts; attemptIndex++)
        {
            ct.ThrowIfCancellationRequested();

            var execution = await ExecuteReceiptAttemptAsync(
                operation,
                job,
                provider,
                payload,
                mimeType,
                systemPrompt,
                config,
                requestPayloadHash,
                providerCall,
                ct);

            if (execution.IsSuccess)
            {
                return execution;
            }

            lastFailure = execution;
            if (attemptIndex >= maxAttempts || !failureClassifier.IsRetryEligible(execution.FailureClass))
            {
                break;
            }

            var retryDelay = GetRetryDelay(attemptIndex);
            logger.LogInformation(
                "Retrying AI {Operation} operation for job {JobId}, provider {Provider}, attempt {AttemptIndex}/{MaxAttempts} after {DelayMs}ms (failure class: {FailureClass}).",
                operation,
                job.Id,
                execution.ProviderUsed,
                attemptIndex + 1,
                maxAttempts,
                retryDelay.TotalMilliseconds,
                execution.FailureClass);

            await Task.Delay(retryDelay, ct);
        }

        return lastFailure ?? ReceiptAttemptExecution.Failed(
            provider?.ProviderType ?? AiProviderType.Gemini,
            AiFailureClass.TransientFailure,
            "Provider execution failed.");
    }

    private async Task<VoiceAttemptExecution> ExecuteVoiceAttemptAsync(
        AiJob job,
        IAiProvider? provider,
        byte[] payload,
        string mimeType,
        string languageHint,
        string systemPrompt,
        AiProviderConfig config,
        string? requestPayloadHash,
        CancellationToken ct)
    {
        if (provider is null)
        {
            return VoiceAttemptExecution.Failed(
                AiProviderType.Gemini,
                AiFailureClass.UnsupportedInput,
                "No AI provider is configured for voice parsing.");
        }

        var attempt = job.AddAttempt(provider.ProviderType, requestPayloadHash);
        var breaker = GetBreaker(provider.ProviderType, config);
        var estimatedCost = attemptCostEstimator.EstimateUnits(
            provider.ProviderType,
            AiOperationType.VoiceToStructuredLog,
            payload.Length,
            job.InputSpeechDurationMs,
            job.InputRawDurationMs);

        if (!breaker.AllowRequest())
        {
            attempt.RecordFailure(AiFailureClass.TransientFailure, "Circuit breaker is open.", null, 0);
            attempt.SetEstimatedCostUnits(estimatedCost);
            return VoiceAttemptExecution.Failed(provider.ProviderType, AiFailureClass.TransientFailure, "Circuit breaker open.", attempt);
        }

        var stopwatch = Stopwatch.StartNew();
        try
        {
            await using var stream = new MemoryStream(payload, writable: false);
            var result = await provider.ParseVoiceAsync(stream, mimeType, languageHint, systemPrompt, ct);
            var latencyMs = ToLatencyMs(stopwatch.Elapsed);

            if (!result.Success)
            {
                var failureClass = failureClassifier.ClassifyProviderError(result.Error);
                attempt.RecordFailure(failureClass, result.Error ?? "Provider call failed.", result.NormalizedJson, latencyMs);
                attempt.SetEstimatedCostUnits(estimatedCost);
                logger.LogWarning(
                    "AI provider {ProviderType} returned failure for {Operation} job {JobId} after {LatencyMs}ms. FailureClass={FailureClass}. Error={Error}",
                    provider.ProviderType,
                    AiOperationType.VoiceToStructuredLog,
                    job.Id,
                    latencyMs,
                    failureClass,
                    result.Error ?? "Provider call failed.");
                breaker.RecordFailure();
                // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.6 — see
                // ExecuteVoiceAttemptAsync catch-block comment.
                breakerRegistry.RecordWindowFailure(provider.ProviderType, AiOperationType.VoiceToStructuredLog);
                return VoiceAttemptExecution.Failed(provider.ProviderType, failureClass, result.Error, attempt);
            }

            if (result.OverallConfidence < config.VoiceConfidenceThreshold)
            {
                attempt.RecordFailure(
                    AiFailureClass.LowConfidence,
                    $"Confidence {result.OverallConfidence:0.000} below threshold {config.VoiceConfidenceThreshold:0.000}.",
                    result.NormalizedJson,
                    latencyMs);
                attempt.SetEstimatedCostUnits(estimatedCost);
                logger.LogWarning(
                    "AI provider {ProviderType} returned low confidence for {Operation} job {JobId} after {LatencyMs}ms. Confidence={Confidence} Threshold={Threshold}",
                    provider.ProviderType,
                    AiOperationType.VoiceToStructuredLog,
                    job.Id,
                    latencyMs,
                    result.OverallConfidence,
                    config.VoiceConfidenceThreshold);
                breaker.RecordFailure();
                breakerRegistry.RecordWindowFailure(provider.ProviderType, AiOperationType.VoiceToStructuredLog);
                return VoiceAttemptExecution.Failed(provider.ProviderType, AiFailureClass.LowConfidence, "Low confidence.", attempt, result);
            }

            attempt.RecordSuccess(result.NormalizedJson ?? "{}", latencyMs, null, result.OverallConfidence);
            attempt.SetEstimatedCostUnits(estimatedCost);
            breaker.RecordSuccess();
            // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.6 — rolling
            // 24h window mirror. The classic breaker counts CONSECUTIVE
            // failures (fast-fail in seconds); this counts the
            // success/failure ratio across the full day so the founder
            // can spot a 5%-sustained regression that never trips the
            // burst threshold.
            breakerRegistry.RecordWindowSuccess(provider.ProviderType, AiOperationType.VoiceToStructuredLog);
            return VoiceAttemptExecution.Succeeded(provider.ProviderType, result, attempt);
        }
        catch (Exception ex)
        {
            var failureClass = failureClassifier.ClassifyException(ex);
            var latencyMs = ToLatencyMs(stopwatch.Elapsed);
            attempt.RecordFailure(failureClass, ex.Message, null, latencyMs);
            attempt.SetEstimatedCostUnits(estimatedCost);
            logger.LogWarning(
                ex,
                "AI provider {ProviderType} threw for {Operation} job {JobId} after {LatencyMs}ms. FailureClass={FailureClass}",
                provider.ProviderType,
                AiOperationType.VoiceToStructuredLog,
                job.Id,
                latencyMs,
                failureClass);
            breaker.RecordFailure();
            breakerRegistry.RecordWindowFailure(provider.ProviderType, AiOperationType.VoiceToStructuredLog);
            return VoiceAttemptExecution.Failed(provider.ProviderType, failureClass, ex.Message, attempt);
        }
    }

    private async Task<ReceiptAttemptExecution> ExecuteReceiptAttemptAsync(
        AiOperationType operation,
        AiJob job,
        IAiProvider? provider,
        byte[] payload,
        string mimeType,
        string systemPrompt,
        AiProviderConfig config,
        string? requestPayloadHash,
        Func<IAiProvider, Stream, string, string, CancellationToken, Task<ReceiptExtractCanonicalResult>> providerCall,
        CancellationToken ct)
    {
        if (provider is null)
        {
            return ReceiptAttemptExecution.Failed(
                AiProviderType.Gemini,
                AiFailureClass.UnsupportedInput,
                "No AI provider is configured.");
        }

        var attempt = job.AddAttempt(provider.ProviderType, requestPayloadHash);
        var breaker = GetBreaker(provider.ProviderType, config);
        var estimatedCost = attemptCostEstimator.EstimateUnits(provider.ProviderType, operation, payload.Length);

        if (!breaker.AllowRequest())
        {
            attempt.RecordFailure(AiFailureClass.TransientFailure, "Circuit breaker is open.", null, 0);
            attempt.SetEstimatedCostUnits(estimatedCost);
            return ReceiptAttemptExecution.Failed(provider.ProviderType, AiFailureClass.TransientFailure, "Circuit breaker open.", attempt);
        }

        var stopwatch = Stopwatch.StartNew();
        try
        {
            await using var stream = new MemoryStream(payload, writable: false);
            var result = await providerCall(provider, stream, mimeType, systemPrompt, ct);
            var latencyMs = ToLatencyMs(stopwatch.Elapsed);

            if (!result.Success)
            {
                var failureClass = failureClassifier.ClassifyProviderError(result.Error);
                attempt.RecordFailure(failureClass, result.Error ?? "Provider call failed.", result.NormalizedJson, latencyMs);
                attempt.SetEstimatedCostUnits(estimatedCost);
                logger.LogWarning(
                    "AI provider {ProviderType} returned failure for {Operation} job {JobId} after {LatencyMs}ms. FailureClass={FailureClass}. Error={Error}",
                    provider.ProviderType,
                    operation,
                    job.Id,
                    latencyMs,
                    failureClass,
                    result.Error ?? "Provider call failed.");
                breaker.RecordFailure();
                // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.6 — see
                // ExecuteVoiceAttemptAsync comment.
                breakerRegistry.RecordWindowFailure(provider.ProviderType, operation);
                return ReceiptAttemptExecution.Failed(provider.ProviderType, failureClass, result.Error, attempt);
            }

            if (result.OverallConfidence < config.ReceiptConfidenceThreshold)
            {
                attempt.RecordFailure(
                    AiFailureClass.LowConfidence,
                    $"Confidence {result.OverallConfidence:0.000} below threshold {config.ReceiptConfidenceThreshold:0.000}.",
                    result.NormalizedJson,
                    latencyMs);
                attempt.SetEstimatedCostUnits(estimatedCost);
                logger.LogWarning(
                    "AI provider {ProviderType} returned low confidence for {Operation} job {JobId} after {LatencyMs}ms. Confidence={Confidence} Threshold={Threshold}",
                    provider.ProviderType,
                    operation,
                    job.Id,
                    latencyMs,
                    result.OverallConfidence,
                    config.ReceiptConfidenceThreshold);
                breaker.RecordFailure();
                breakerRegistry.RecordWindowFailure(provider.ProviderType, operation);
                return ReceiptAttemptExecution.Failed(provider.ProviderType, AiFailureClass.LowConfidence, "Low confidence.", attempt);
            }

            attempt.RecordSuccess(result.NormalizedJson ?? "{}", latencyMs, null, result.OverallConfidence);
            attempt.SetEstimatedCostUnits(estimatedCost);
            breaker.RecordSuccess();
            breakerRegistry.RecordWindowSuccess(provider.ProviderType, operation);
            return ReceiptAttemptExecution.Succeeded(provider.ProviderType, result, attempt);
        }
        catch (Exception ex)
        {
            var failureClass = failureClassifier.ClassifyException(ex);
            var latencyMs = ToLatencyMs(stopwatch.Elapsed);
            attempt.RecordFailure(failureClass, ex.Message, null, latencyMs);
            attempt.SetEstimatedCostUnits(estimatedCost);
            logger.LogWarning(
                ex,
                "AI provider {ProviderType} threw for {Operation} job {JobId} after {LatencyMs}ms. FailureClass={FailureClass}",
                provider.ProviderType,
                operation,
                job.Id,
                latencyMs,
                failureClass);
            breaker.RecordFailure();
            breakerRegistry.RecordWindowFailure(provider.ProviderType, operation);
            return ReceiptAttemptExecution.Failed(provider.ProviderType, failureClass, ex.Message, attempt);
        }
    }

    private IAiProvider? ResolveProvider(AiProviderType preferredType, AiOperationType operation)
    {
        if (_providers.TryGetValue(preferredType, out var preferred) && preferred.CanHandle(operation))
        {
            return preferred;
        }

        return _providers.Values.FirstOrDefault(provider => provider.CanHandle(operation));
    }

    private IAiProvider? ResolveVoiceStructurerProvider(AiProviderConfig config)
    {
        if (_providers.TryGetValue(AiProviderType.Gemini, out var gemini) &&
            gemini.CanHandle(AiOperationType.VoiceToStructuredLog))
        {
            return gemini;
        }

        return ResolveProvider(
            config.GetProviderForOperation(AiOperationType.VoiceToStructuredLog),
            AiOperationType.VoiceToStructuredLog);
    }

    private IAiProvider? ResolveFallbackProvider(AiProviderType? primaryType, AiOperationType operation)
    {
        return _providers.Values.FirstOrDefault(provider =>
            provider.CanHandle(operation) &&
            (!primaryType.HasValue || provider.ProviderType != primaryType.Value));
    }

    private CircuitBreaker GetBreaker(AiProviderType providerType, AiProviderConfig config)
    {
        return breakerRegistry.GetOrAdd(
            providerType,
            config.CircuitBreakerThreshold,
            TimeSpan.FromSeconds(config.CircuitBreakerResetSeconds));
    }

    // MaxRetries is interpreted as max attempts per provider execution path.
    private static int ResolveMaxAttemptsPerProvider(int configuredMaxRetries)
    {
        return Math.Clamp(configuredMaxRetries, MinProviderAttempts, MaxProviderAttempts);
    }

    private static TimeSpan GetRetryDelay(int completedAttemptCount)
    {
        var boundedExponent = Math.Clamp(completedAttemptCount - 1, 0, 4);
        var delayMs = RetryBaseDelayMs * (1 << boundedExponent);
        var boundedMs = Math.Clamp(delayMs, RetryBaseDelayMs, RetryMaxDelayMs);
        return TimeSpan.FromMilliseconds(boundedMs);
    }

    private static int ToLatencyMs(TimeSpan elapsed)
    {
        var milliseconds = elapsed.TotalMilliseconds;
        if (milliseconds <= 0)
        {
            return 0;
        }

        if (milliseconds >= int.MaxValue)
        {
            return int.MaxValue;
        }

        return (int)Math.Round(milliseconds, MidpointRounding.AwayFromZero);
    }

    // voice-rawblob-resilient-2026-06-10 — NON-FATAL cold-tier persistence.
    //
    // The raw-blob store is compliance/audit only (DPDP raw-voice retention).
    // A storage-infra failure (e.g. the AWSSDK.S3 v4 PutObject
    // SignatureDoesNotMatch regression on prod) MUST NOT fail the farmer's
    // voice/receipt parse — the model has already done the real work. Any
    // exception from the PUT (or the ref-count index upsert that depends on
    // the resulting blobRef) is logged at ERROR (alertable) and swallowed;
    // the method returns null so the caller stamps rawInputRef=null — a valid
    // Phase-01 state (AiJob.Create normalizes null/empty rawInputRef). Only
    // this storage step is made non-fatal; Gemini/parse failures still
    // propagate through the normal attempt/fallback path below.
    //
    // OperationCanceledException is re-thrown so request cancellation still
    // unwinds normally and is never masquerading as a "store failed" log.
    private async Task<RawBlobRef?> TryPersistRawBlobAsync(byte[] payload, string mimeType, CancellationToken ct)
    {
        try
        {
            using var blobStream = new MemoryStream(payload, writable: false);
            var blobRef = await blobStore.PutAsync(blobStream, mimeType, ct);
            await shramSafalRepository.UpsertRawBlobIndexAsync(blobRef, ct);
            return blobRef;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogError(
                ex,
                "[raw-blob-store] PUT failed — voice parse continues without raw-audio retention; rawInputRef=null. Bucket={Bucket}",
                ColdTierBucketLabel);
            return null;
        }
    }

    private static async Task<byte[]> ReadPayloadAsync(Stream stream, CancellationToken ct)
    {
        if (stream.CanSeek)
        {
            stream.Position = 0;
        }

        await using var memory = new MemoryStream();
        await stream.CopyToAsync(memory, ct);
        return memory.ToArray();
    }

    private static bool TryReturnCachedVoiceResult(
        AiJob? job,
        out (VoiceParseCanonicalResult Result, Guid JobId, AiProviderType ProviderUsed, bool FallbackUsed) cached,
        string? promptContentHash = null)
    {
        cached = default;

        if (job is null ||
            job.Status is not (AiJobStatus.Succeeded or AiJobStatus.FallbackSucceeded) ||
            string.IsNullOrWhiteSpace(job.NormalizedResultJson))
        {
            return false;
        }

        // DATA_PRINCIPLE_SPINE sub-phase 01.4 — preserve the cached job's
        // original prompt content hash when present (it lives on the AiJob's
        // Provenance), otherwise fall back to the current builder hash passed
        // in by the caller. The cached path returns immediately so the
        // downstream handler still gets a non-null hash to stamp.
        var cachedHash = job.Provenance?.PromptContentHash ?? promptContentHash;

        cached = (
            new VoiceParseCanonicalResult
            {
                Success = true,
                NormalizedJson = job.NormalizedResultJson,
                RawTranscript = TryReadJsonString(job.NormalizedResultJson, "fullTranscript"),
                OverallConfidence = TryReadJsonDecimal(job.NormalizedResultJson, "confidence") ?? 0.75m,
                PromptContentHash = cachedHash
            },
            job.Id,
            job.Attempts.LastOrDefault(x => x.IsSuccess)?.Provider ?? AiProviderType.Gemini,
            job.Status == AiJobStatus.FallbackSucceeded);

        return true;
    }

    private static string? TryReadJsonString(string json, string propertyName)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            return document.RootElement.TryGetProperty(propertyName, out var node) &&
                   node.ValueKind == JsonValueKind.String
                ? node.GetString()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static decimal? TryReadJsonDecimal(string json, string propertyName)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            if (!document.RootElement.TryGetProperty(propertyName, out var node))
            {
                return null;
            }

            if (node.ValueKind == JsonValueKind.Number && node.TryGetDecimal(out var value))
            {
                if (value > 1m)
                {
                    value /= 100m;
                }

                return Math.Clamp(value, 0m, 1m);
            }

            return null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static bool IsEmptyJsonObject(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            return document.RootElement.ValueKind == JsonValueKind.Object &&
                   !document.RootElement.EnumerateObject().Any();
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private sealed record VoiceAttemptExecution(
        bool IsSuccess,
        VoiceParseCanonicalResult Result,
        AiProviderType ProviderUsed,
        AiFailureClass FailureClass,
        AiJobAttempt? Attempt)
    {
        public static VoiceAttemptExecution Succeeded(
            AiProviderType providerUsed,
            VoiceParseCanonicalResult result,
            AiJobAttempt attempt) =>
            new(true, result, providerUsed, AiFailureClass.None, attempt);

        public static VoiceAttemptExecution Failed(
            AiProviderType providerUsed,
            AiFailureClass failureClass,
            string? error,
            AiJobAttempt? attempt = null,
            VoiceParseCanonicalResult? providerResult = null) =>
            new(
                false,
                providerResult ?? new VoiceParseCanonicalResult { Success = false, Error = error },
                providerUsed,
                failureClass,
                attempt);
    }

    private sealed record ReceiptAttemptExecution(
        bool IsSuccess,
        ReceiptExtractCanonicalResult Result,
        AiProviderType ProviderUsed,
        AiFailureClass FailureClass,
        AiJobAttempt? Attempt)
    {
        public static ReceiptAttemptExecution Succeeded(
            AiProviderType providerUsed,
            ReceiptExtractCanonicalResult result,
            AiJobAttempt attempt) =>
            new(true, result, providerUsed, AiFailureClass.None, attempt);

        public static ReceiptAttemptExecution Failed(
            AiProviderType providerUsed,
            AiFailureClass failureClass,
            string? error,
            AiJobAttempt? attempt = null) =>
            new(
                false,
                new ReceiptExtractCanonicalResult { Success = false, Error = error },
                providerUsed,
                failureClass,
                attempt);
    }
}
