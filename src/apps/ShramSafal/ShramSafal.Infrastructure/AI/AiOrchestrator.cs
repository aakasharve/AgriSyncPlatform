using System.Diagnostics;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.AI;

namespace ShramSafal.Infrastructure.AI;

internal sealed class AiOrchestrator(
    IEnumerable<IAiProvider> providers,
    IAiJobRepository aiJobRepository,
    AiCircuitBreakerRegistry breakerRegistry,
    AiFailureClassifier failureClassifier,
    AiAttemptCostEstimator attemptCostEstimator,
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
        CancellationToken ct = default)
    {
        var key = string.IsNullOrWhiteSpace(idempotencyKey) ? Guid.NewGuid().ToString("N") : idempotencyKey.Trim();
        var existing = await aiJobRepository.GetByIdempotencyKeyAsync(key, ct);
        if (TryReturnCachedVoiceResult(existing, out var cached))
        {
            return cached;
        }

        var config = await aiJobRepository.GetProviderConfigAsync(ct);
        var payload = await ReadPayloadAsync(audioStream, ct);

        var job = existing ?? AiJob.Create(
            Guid.NewGuid(),
            key,
            AiOperationType.VoiceToStructuredLog,
            userId,
            farmId,
            inputContentHash: requestPayloadHash,
            inputStoragePath: null,
            inputSessionMetadataJson: segmentMetadataJson);

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
                    Error = "AI processing is currently disabled."
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
            job.MarkFallbackSucceeded(fallbackExecution.Result.NormalizedJson ?? "{}", fallbackExecution.Attempt!);
            await aiJobRepository.SaveChangesAsync(ct);
            return (fallbackExecution.Result, job.Id, fallbackExecution.ProviderUsed, true);
        }

        job.MarkFailed();
        await aiJobRepository.SaveChangesAsync(ct);
        return (fallbackExecution.Result, job.Id, fallbackExecution.ProviderUsed, true);
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
            !string.IsNullOrWhiteSpace(existing.NormalizedResultJson))
        {
            return (
                new ReceiptExtractCanonicalResult
                {
                    Success = true,
                    NormalizedJson = existing.NormalizedResultJson
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
            logger.LogWarning(ex, "AI provider {ProviderType} failed for job {JobId}.", provider.ProviderType, job.Id);
            var failureClass = failureClassifier.ClassifyException(ex);
            var latencyMs = ToLatencyMs(stopwatch.Elapsed);
            attempt.RecordFailure(failureClass, ex.Message, null, latencyMs);
            attempt.SetEstimatedCostUnits(estimatedCost);
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
            logger.LogWarning(ex, "AI provider {ProviderType} failed for job {JobId}.", provider.ProviderType, job.Id);
            var failureClass = failureClassifier.ClassifyException(ex);
            var latencyMs = ToLatencyMs(stopwatch.Elapsed);
            attempt.RecordFailure(failureClass, ex.Message, null, latencyMs);
            attempt.SetEstimatedCostUnits(estimatedCost);
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
        out (VoiceParseCanonicalResult Result, Guid JobId, AiProviderType ProviderUsed, bool FallbackUsed) cached)
    {
        cached = default;

        if (job is null ||
            job.Status is not (AiJobStatus.Succeeded or AiJobStatus.FallbackSucceeded) ||
            string.IsNullOrWhiteSpace(job.NormalizedResultJson))
        {
            return false;
        }

        cached = (
            new VoiceParseCanonicalResult
            {
                Success = true,
                NormalizedJson = job.NormalizedResultJson,
                RawTranscript = TryReadJsonString(job.NormalizedResultJson, "fullTranscript"),
                OverallConfidence = TryReadJsonDecimal(job.NormalizedResultJson, "confidence") ?? 0.75m
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

            return node.ValueKind == JsonValueKind.Number && node.TryGetDecimal(out var value)
                ? Math.Clamp(value, 0m, 1m)
                : null;
        }
        catch (JsonException)
        {
            return null;
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
