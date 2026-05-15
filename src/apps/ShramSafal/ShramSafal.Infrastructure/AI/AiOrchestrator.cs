using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Common;

namespace ShramSafal.Infrastructure.AI;

internal sealed class AiOrchestrator(
    IEnumerable<IAiProvider> providers,
    IAiJobRepository aiJobRepository,
    AiCircuitBreakerRegistry breakerRegistry,
    AiFailureClassifier failureClassifier,
    AiAttemptCostEstimator attemptCostEstimator,
    IAiPromptBuilder promptBuilder,
    ILogger<AiOrchestrator> logger) : IAiOrchestrator
{
    private const int MinProviderAttempts = 1;
    private const int MaxProviderAttempts = 5;
    private const int RetryBaseDelayMs = 200;
    private const int RetryMaxDelayMs = 2000;

    private readonly Dictionary<AiProviderType, IAiProvider> _providers = providers
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

        // DATA_PRINCIPLE_SPINE sub-phase 01.4 — stamp the AiJob with real voice
        // provenance instead of the Manual("unknown") default.
        // PromptVersion carries the stable semver label "v1"; the 64-char
        // content hash lives in PromptContentHash for forensic identity
        // (Y.md §7 Option C). ModelVersion is stamped as "unknown" here and
        // replaced post-attempt via AiJob.UpdateProvenance (F3).
        var voiceProvenance = new Provenance(
            source: Source.Voice,
            modelVersion: "unknown",
            promptVersion: "v1", // Y.md §7 Option C — stable label; hash lives in PromptContentHash.
            promptContentHash: promptContentHash,
            appVersion: string.IsNullOrWhiteSpace(clientAppVersion) ? "unknown" : clientAppVersion);

        var job = existing ?? AiJob.Create(
            Guid.NewGuid(),
            key,
            AiOperationType.VoiceToStructuredLog,
            userId,
            farmId,
            inputContentHash: requestPayloadHash,
            rawInputRef: null,
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

        var provider = ResolveProvider(
            config.GetProviderForOperation(AiOperationType.VoiceToStructuredLog),
            AiOperationType.VoiceToStructuredLog);

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
        var provider = ResolveProvider(
            config.GetProviderForOperation(AiOperationType.VoiceToStructuredLog),
            AiOperationType.VoiceToStructuredLog);

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
            ct);
    }

    public async Task<(ReceiptExtractCanonicalResult Result, Guid JobId, AiProviderType ProviderUsed, bool FallbackUsed)> ExtractPattiWithFallbackAsync(
        Guid userId,
        Guid farmId,
        Stream imageStream,
        string mimeType,
        string systemPrompt,
        string idempotencyKey,
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
        var job = existing ?? AiJob.Create(Guid.NewGuid(), key, operation, userId, farmId, null, null);

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
                return VoiceAttemptExecution.Failed(provider.ProviderType, AiFailureClass.LowConfidence, "Low confidence.", attempt, result);
            }

            attempt.RecordSuccess(result.NormalizedJson ?? "{}", latencyMs, null, result.OverallConfidence);
            attempt.SetEstimatedCostUnits(estimatedCost);
            breaker.RecordSuccess();
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
                return ReceiptAttemptExecution.Failed(provider.ProviderType, AiFailureClass.LowConfidence, "Low confidence.", attempt);
            }

            attempt.RecordSuccess(result.NormalizedJson ?? "{}", latencyMs, null, result.OverallConfidence);
            attempt.SetEstimatedCostUnits(estimatedCost);
            breaker.RecordSuccess();
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
