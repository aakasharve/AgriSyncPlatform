using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.AI;
using ShramSafal.Infrastructure.AI;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

public sealed class AiOrchestratorTests
{
    [Fact]
    public async Task PrimarySucceeds_NoFallback()
    {
        var harness = CreateHarness(CreateConfig());
        harness.Gemini.EnqueueVoiceResult(SuccessVoiceResult(0.91m));

        var execution = await ExecuteVoiceAsync(
            harness.Orchestrator,
            harness.UserId,
            harness.FarmId,
            "orchestrator-primary-success-1");

        Assert.True(execution.Result.Success);
        Assert.False(execution.FallbackUsed);
        Assert.Equal(AiProviderType.Gemini, execution.ProviderUsed);
        Assert.Equal(0, harness.Sarvam.VoiceParseCallCount);
        Assert.Equal(1, harness.Gemini.VoiceParseCallCount);
    }

    [Fact]
    public async Task PrimaryTransientFailure_UsesFallback()
    {
        var harness = CreateHarness(CreateConfig());
        harness.Gemini.EnqueueVoiceResult(FailedVoiceResult("timeout transient failure"));
        harness.Sarvam.EnqueueVoiceResult(SuccessVoiceResult(0.88m));

        var execution = await ExecuteVoiceAsync(
            harness.Orchestrator,
            harness.UserId,
            harness.FarmId,
            "orchestrator-fallback-1");

        Assert.True(execution.Result.Success);
        Assert.True(execution.FallbackUsed);
        Assert.Equal(AiProviderType.Sarvam, execution.ProviderUsed);

        var job = await harness.Repository.GetByIdAsync(execution.JobId);
        Assert.NotNull(job);
        Assert.Equal(AiJobStatus.FallbackSucceeded, job!.Status);
        Assert.Equal(2, job.TotalAttempts);
    }

    [Fact]
    public async Task PrimaryUserError_DoesNotFallback()
    {
        var harness = CreateHarness(CreateConfig());
        harness.Gemini.EnqueueVoiceResult(FailedVoiceResult("invalid input required field"));
        harness.Sarvam.EnqueueVoiceResult(SuccessVoiceResult(0.90m));

        var execution = await ExecuteVoiceAsync(
            harness.Orchestrator,
            harness.UserId,
            harness.FarmId,
            "orchestrator-user-error-1");

        Assert.False(execution.Result.Success);
        Assert.False(execution.FallbackUsed);
        Assert.Equal(AiProviderType.Gemini, execution.ProviderUsed);
        Assert.Equal(0, harness.Sarvam.VoiceParseCallCount);
        Assert.Equal(1, harness.Gemini.VoiceParseCallCount);

        var job = await harness.Repository.GetByIdAsync(execution.JobId);
        Assert.NotNull(job);
        Assert.Equal(AiJobStatus.Failed, job!.Status);
    }

    [Fact]
    public async Task BothFail_JobMarkedFailed()
    {
        var harness = CreateHarness(CreateConfig());
        harness.Gemini.EnqueueVoiceResult(FailedVoiceResult("timeout transient failure"));
        harness.Sarvam.EnqueueVoiceResult(FailedVoiceResult("schema parse failure"));

        var execution = await ExecuteVoiceAsync(
            harness.Orchestrator,
            harness.UserId,
            harness.FarmId,
            "orchestrator-both-fail-1");

        Assert.False(execution.Result.Success);
        Assert.True(execution.FallbackUsed);
        Assert.Equal(AiProviderType.Sarvam, execution.ProviderUsed);

        var job = await harness.Repository.GetByIdAsync(execution.JobId);
        Assert.NotNull(job);
        Assert.Equal(AiJobStatus.Failed, job!.Status);
        Assert.Equal(2, job.TotalAttempts);
    }

    [Fact]
    public async Task IdempotencyKeyHit_ReturnsCachedResultWithoutDuplicateProviderCalls()
    {
        var harness = CreateHarness(CreateConfig());
        harness.Gemini.EnqueueVoiceResult(SuccessVoiceResult(0.93m));
        const string key = "orchestrator-idempotency-1";

        var first = await ExecuteVoiceAsync(
            harness.Orchestrator,
            harness.UserId,
            harness.FarmId,
            key);
        var second = await ExecuteVoiceAsync(
            harness.Orchestrator,
            harness.UserId,
            harness.FarmId,
            key);

        Assert.True(first.Result.Success);
        Assert.True(second.Result.Success);
        Assert.Equal(first.JobId, second.JobId);
        Assert.Equal(1, harness.Gemini.VoiceParseCallCount);
    }

    [Fact]
    public async Task CircuitBreakerOpens_SkipsPrimaryAndUsesFallback()
    {
        var harness = CreateHarness(CreateConfig(circuitBreakerThreshold: 1, circuitBreakerResetSeconds: 60));
        harness.Gemini.EnqueueVoiceResult(FailedVoiceResult("timeout transient failure"));
        harness.Sarvam.EnqueueVoiceResult(SuccessVoiceResult(0.80m));
        harness.Sarvam.EnqueueVoiceResult(SuccessVoiceResult(0.81m));

        var first = await ExecuteVoiceAsync(
            harness.Orchestrator,
            harness.UserId,
            harness.FarmId,
            "orchestrator-breaker-open-1");
        var second = await ExecuteVoiceAsync(
            harness.Orchestrator,
            harness.UserId,
            harness.FarmId,
            "orchestrator-breaker-open-2");

        Assert.True(first.FallbackUsed);
        Assert.True(second.FallbackUsed);
        Assert.Equal(2, harness.Sarvam.VoiceParseCallCount);
        Assert.Equal(1, harness.Gemini.VoiceParseCallCount);
    }

    [Fact]
    public async Task CircuitBreakerResetsAfterInterval_AllowsPrimaryAgain()
    {
        var harness = CreateHarness(CreateConfig(circuitBreakerThreshold: 1, circuitBreakerResetSeconds: 10));
        harness.Gemini.EnqueueVoiceResult(FailedVoiceResult("timeout transient failure"));
        harness.Sarvam.EnqueueVoiceResult(SuccessVoiceResult(0.80m));
        harness.Gemini.EnqueueVoiceResult(SuccessVoiceResult(0.92m));

        var first = await ExecuteVoiceAsync(
            harness.Orchestrator,
            harness.UserId,
            harness.FarmId,
            "orchestrator-breaker-reset-1");
        await Task.Delay(TimeSpan.FromMilliseconds(10_500));
        var second = await ExecuteVoiceAsync(
            harness.Orchestrator,
            harness.UserId,
            harness.FarmId,
            "orchestrator-breaker-reset-2");

        Assert.True(first.FallbackUsed);
        Assert.False(second.FallbackUsed);
        Assert.Equal(AiProviderType.Gemini, second.ProviderUsed);
        Assert.Equal(2, harness.Gemini.VoiceParseCallCount);
    }

    private static async Task<(VoiceParseCanonicalResult Result, Guid JobId, AiProviderType ProviderUsed, bool FallbackUsed)> ExecuteVoiceAsync(
        AiOrchestrator orchestrator,
        Guid userId,
        Guid farmId,
        string idempotencyKey)
    {
        await using var payload = new MemoryStream([0x01, 0x02, 0x03, 0x04]);
        return await orchestrator.ParseVoiceWithFallbackAsync(
            userId,
            farmId,
            payload,
            "audio/webm",
            "system-prompt",
            idempotencyKey,
            ct: CancellationToken.None);
    }

    private static VoiceParseCanonicalResult SuccessVoiceResult(decimal confidence)
    {
        return new VoiceParseCanonicalResult
        {
            Success = true,
            NormalizedJson = """
                             {
                               "summary":"ok",
                               "dayOutcome":"WORK_RECORDED",
                               "cropActivities":[],
                               "irrigation":[],
                               "labour":[],
                               "inputs":[],
                               "machinery":[],
                               "activityExpenses":[],
                               "observations":[],
                               "plannedTasks":[],
                               "missingSegments":[],
                               "unclearSegments":[],
                               "questionsForUser":[],
                               "fieldConfidences":{},
                               "confidence":0.9,
                               "fullTranscript":"test"
                             }
                             """,
            OverallConfidence = confidence
        };
    }

    private static VoiceParseCanonicalResult FailedVoiceResult(string error)
    {
        return new VoiceParseCanonicalResult
        {
            Success = false,
            Error = error
        };
    }

    private static AiProviderConfig CreateConfig(
        int maxRetries = 1,
        int circuitBreakerThreshold = 5,
        int circuitBreakerResetSeconds = 60)
    {
        var config = AiProviderConfig.CreateDefault();
        config.UpdateSettings(
            modifiedByUserId: Guid.NewGuid(),
            defaultProvider: AiProviderType.Gemini,
            fallbackEnabled: true,
            isAiProcessingDisabled: false,
            maxRetries: maxRetries,
            circuitBreakerThreshold: circuitBreakerThreshold,
            circuitBreakerResetSeconds: circuitBreakerResetSeconds,
            voiceConfidenceThreshold: 0.60m,
            receiptConfidenceThreshold: 0.50m);
        return config;
    }

    private static OrchestratorTestHarness CreateHarness(AiProviderConfig config)
    {
        var repository = new InMemoryAiJobRepository(config);
        var sarvam = new FakeAiProvider(AiProviderType.Sarvam);
        var gemini = new FakeAiProvider(AiProviderType.Gemini);

        var orchestrator = new AiOrchestrator(
            [sarvam, gemini],
            repository,
            new AiCircuitBreakerRegistry(),
            new AiFailureClassifier(),
            new AiAttemptCostEstimator(),
            NullLogger<AiOrchestrator>.Instance);

        return new OrchestratorTestHarness(
            orchestrator,
            repository,
            sarvam,
            gemini,
            Guid.NewGuid(),
            Guid.NewGuid());
    }

    private sealed record OrchestratorTestHarness(
        AiOrchestrator Orchestrator,
        InMemoryAiJobRepository Repository,
        FakeAiProvider Sarvam,
        FakeAiProvider Gemini,
        Guid UserId,
        Guid FarmId);
}

internal sealed class InMemoryAiJobRepository(AiProviderConfig config) : IAiJobRepository
{
    private readonly Dictionary<Guid, AiJob> _jobsById = new();
    private readonly Dictionary<string, AiJob> _jobsByIdempotency = new(StringComparer.Ordinal);
    private AiProviderConfig _config = config;

    public Task<AiJob?> GetByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(idempotencyKey))
        {
            return Task.FromResult<AiJob?>(null);
        }

        _jobsByIdempotency.TryGetValue(idempotencyKey.Trim(), out var job);
        return Task.FromResult(job);
    }

    public Task<AiJob?> GetByIdAsync(Guid jobId, CancellationToken ct = default)
    {
        _jobsById.TryGetValue(jobId, out var job);
        return Task.FromResult(job);
    }

    public Task AddAsync(AiJob job, CancellationToken ct = default)
    {
        _jobsById[job.Id] = job;
        _jobsByIdempotency[job.IdempotencyKey] = job;
        return Task.CompletedTask;
    }

    public Task UpdateAsync(AiJob job, CancellationToken ct = default)
    {
        _jobsById[job.Id] = job;
        _jobsByIdempotency[job.IdempotencyKey] = job;
        return Task.CompletedTask;
    }

    public Task<AiProviderConfig> GetProviderConfigAsync(CancellationToken ct = default)
    {
        return Task.FromResult(_config);
    }

    public Task SaveProviderConfigAsync(AiProviderConfig config, CancellationToken ct = default)
    {
        _config = config;
        return Task.CompletedTask;
    }

    public Task SaveChangesAsync(CancellationToken ct = default)
    {
        return Task.CompletedTask;
    }

    public Task<List<AiJob>> GetRecentJobsAsync(int limit, AiOperationType? operationType, CancellationToken ct = default)
    {
        var query = _jobsById.Values.AsEnumerable();
        if (operationType.HasValue)
        {
            query = query.Where(job => job.OperationType == operationType.Value);
        }

        return Task.FromResult(query
            .OrderByDescending(job => job.CreatedAtUtc)
            .Take(Math.Clamp(limit, 1, 200))
            .ToList());
    }

    public Task<Dictionary<AiProviderType, int>> GetSuccessCountByProviderAsync(DateTime since, CancellationToken ct = default)
    {
        return Task.FromResult(CountAttempts(since, successOnly: true));
    }

    public Task<Dictionary<AiProviderType, int>> GetFailureCountByProviderAsync(DateTime since, CancellationToken ct = default)
    {
        return Task.FromResult(CountAttempts(since, successOnly: false));
    }

    private Dictionary<AiProviderType, int> CountAttempts(DateTime since, bool successOnly)
    {
        var result = Enum.GetValues<AiProviderType>().ToDictionary(provider => provider, _ => 0);
        var attempts = _jobsById.Values
            .SelectMany(job => job.Attempts)
            .Where(attempt => attempt.AttemptedAtUtc >= since && attempt.IsSuccess == successOnly);

        foreach (var attempt in attempts)
        {
            result[attempt.Provider]++;
        }

        return result;
    }
}

internal sealed class FakeAiProvider(AiProviderType providerType) : IAiProvider
{
    private readonly Queue<VoiceParseCanonicalResult> _voiceResults = new();

    public AiProviderType ProviderType { get; } = providerType;

    public int VoiceParseCallCount { get; private set; }

    public void EnqueueVoiceResult(VoiceParseCanonicalResult result)
    {
        _voiceResults.Enqueue(result);
    }

    public Task<bool> HealthCheckAsync(CancellationToken ct = default)
    {
        return Task.FromResult(true);
    }

    public bool CanHandle(AiOperationType operation) => true;

    public Task<VoiceParseCanonicalResult> ParseVoiceAsync(
        Stream audioStream,
        string mimeType,
        string languageHint,
        string systemPrompt,
        CancellationToken ct = default)
    {
        VoiceParseCallCount++;
        if (_voiceResults.TryDequeue(out var result))
        {
            return Task.FromResult(result);
        }

        return Task.FromResult(new VoiceParseCanonicalResult
        {
            Success = true,
            NormalizedJson = "{}",
            OverallConfidence = 0.90m
        });
    }

    public Task<ReceiptExtractCanonicalResult> ExtractReceiptAsync(
        Stream imageStream,
        string mimeType,
        string systemPrompt,
        CancellationToken ct = default)
    {
        return Task.FromResult(new ReceiptExtractCanonicalResult
        {
            Success = true,
            NormalizedJson = "{}",
            OverallConfidence = 0.85m
        });
    }

    public Task<ReceiptExtractCanonicalResult> ExtractPattiAsync(
        Stream imageStream,
        string mimeType,
        string systemPrompt,
        CancellationToken ct = default)
    {
        return Task.FromResult(new ReceiptExtractCanonicalResult
        {
            Success = true,
            NormalizedJson = "{}",
            OverallConfidence = 0.85m
        });
    }
}
