using System.Runtime.CompilerServices;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.Storage;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Storage;
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

    [Fact]
    public async Task StreamingTextParse_UsesGeminiStructurer_WhenVoiceDefaultIsSarvam()
    {
        var harness = CreateHarness(AiProviderConfig.CreateDefault());
        harness.Gemini.EnqueueStreamChunks(
            "{\"summary\":\"ok\",",
            "\"confidence\":0.91}");

        var events = new List<ParseStreamEvent>();
        await foreach (var evt in harness.Orchestrator.ParseVoiceStreamAsync(
                           "आज grapes ला spray मारला.",
                           new VoiceParseContext(
                               AvailableCrops: [],
                               Profile: new FarmerProfileInfo([], [], [], null),
                               FarmContext: null,
                               FocusCategory: null,
                               VocabDb: null),
                           scenarioId: "sarvam-default-structurer-test",
                           CancellationToken.None))
        {
            events.Add(evt);
        }

        Assert.Equal(0, harness.Sarvam.VoiceStreamCallCount);
        Assert.Equal(1, harness.Gemini.VoiceStreamCallCount);
        Assert.Contains(events, evt => evt.Type == "complete");
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
        var blobStore = new InMemoryRawBlobStore();
        var ssfRepository = new RecordingShramSafalRepository();

        var orchestrator = new AiOrchestrator(
            [sarvam, gemini],
            // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.4 — new
            // ITranscriberProvider dependency. Legacy tests exercise only
            // ParseVoiceWithFallbackAsync, so an empty enumerable preserves
            // the previous behavior; ParseVoiceTwoStageAsync would resolve
            // its tuple, see no registered transcriber for the desired
            // type, and delegate back to the legacy path.
            Array.Empty<ShramSafal.Application.Ports.External.ITranscriberProvider>(),
            repository,
            new AiCircuitBreakerRegistry(),
            new AiFailureClassifier(),
            new AiAttemptCostEstimator(),
            new AiPromptBuilder(),
            blobStore,
            ssfRepository,
            NullLogger<AiOrchestrator>.Instance);

        return new OrchestratorTestHarness(
            orchestrator,
            repository,
            sarvam,
            gemini,
            blobStore,
            ssfRepository,
            Guid.NewGuid(),
            Guid.NewGuid());
    }

    private sealed record OrchestratorTestHarness(
        AiOrchestrator Orchestrator,
        InMemoryAiJobRepository Repository,
        FakeAiProvider Sarvam,
        FakeAiProvider Gemini,
        InMemoryRawBlobStore BlobStore,
        RecordingShramSafalRepository ShramSafalRepository,
        Guid UserId,
        Guid FarmId);

    /// <summary>
    /// DATA_PRINCIPLE_SPINE 02-patch: assert that a successful voice parse
    /// stamps the AiJob's <see cref="AiJob.RawInputRef"/> with the SHA-256
    /// of the audio payload (instead of <c>null</c>, the BLOCKER #1 surfaced
    /// by Codex cross-verification on 2026-05-15) AND that the cold-tier
    /// blob store receives the bytes AND that the ref-count index is
    /// upserted in the same flow.
    /// </summary>
    [Fact]
    public async Task SuccessfulVoiceParse_PersistsRawInputToColdTier_AndStampsRawInputRefOnAiJob()
    {
        var harness = CreateHarness(CreateConfig());
        harness.Gemini.EnqueueVoiceResult(SuccessVoiceResult(0.91m));

        var execution = await ExecuteVoiceAsync(
            harness.Orchestrator,
            harness.UserId,
            harness.FarmId,
            "orchestrator-rawinput-1");

        Assert.True(execution.Result.Success);

        var job = await harness.Repository.GetByIdAsync(execution.JobId);
        Assert.NotNull(job);
        Assert.False(string.IsNullOrWhiteSpace(job!.RawInputRef));
        Assert.Equal(64, job.RawInputRef!.Length); // sha-256 lowercase hex

        // Blob store received exactly one PUT for the payload.
        Assert.Single(harness.BlobStore.Puts);
        Assert.Equal(job.RawInputRef, harness.BlobStore.Puts[0].Sha256);

        // Ref-count index upserted once with the same SHA.
        Assert.Single(harness.ShramSafalRepository.RawBlobUpserts);
        Assert.Equal(job.RawInputRef, harness.ShramSafalRepository.RawBlobUpserts[0].Sha256);
    }
}

/// <summary>
/// DATA_PRINCIPLE_SPINE 02-patch: minimal cold-tier stub. Returns a
/// <see cref="RawBlobRef"/> computed from the bytes it receives, records
/// every PUT for assertion, and never touches a real S3 client.
/// </summary>
internal sealed class InMemoryRawBlobStore : IRawBlobStore
{
    public List<RawBlobRef> Puts { get; } = new();
    public Dictionary<string, byte[]> Storage { get; } = new(StringComparer.Ordinal);

    public async Task<RawBlobRef> PutAsync(Stream payload, string contentType, CancellationToken ct)
    {
        using var ms = new MemoryStream();
        await payload.CopyToAsync(ms, ct);
        var bytes = ms.ToArray();
        var blobRef = RawBlobRef.FromBytes(bytes, contentType);
        Puts.Add(blobRef);
        Storage[blobRef.Sha256] = bytes;
        return blobRef;
    }

    public Task<Stream> GetAsync(string sha256, CancellationToken ct)
    {
        if (!Storage.TryGetValue(sha256, out var bytes))
        {
            throw new InvalidOperationException($"No blob with sha {sha256}.");
        }
        return Task.FromResult<Stream>(new MemoryStream(bytes, writable: false));
    }

    public Task DereferenceAsync(string sha256, CancellationToken ct)
    {
        Storage.Remove(sha256);
        return Task.CompletedTask;
    }
}

/// <summary>
/// DATA_PRINCIPLE_SPINE 02-patch: inert <see cref="ShramSafal.Application.Ports.IShramSafalRepository"/>
/// the orchestrator calls only for <c>UpsertRawBlobIndexAsync</c>. Every
/// other member uses the interface's default no-op impl, so this class
/// stays a one-method recorder. Any future codepath that routes through a
/// new interface method without a default will surface as a runtime
/// AbstractMethodCall — exactly the loud failure the existing
/// <c>AddTranscriptAsync</c> convention defends.
/// </summary>
internal sealed class RecordingShramSafalRepository : ShramSafal.Application.Ports.IShramSafalRepository
{
    public List<RawBlobRef> RawBlobUpserts { get; } = new();

    public Task UpsertRawBlobIndexAsync(RawBlobRef blobRef, CancellationToken ct = default)
    {
        RawBlobUpserts.Add(blobRef);
        return Task.CompletedTask;
    }

    // Required (no-default) members must be implemented; the orchestrator
    // never invokes any of them on the voice / receipt / patti paths under
    // test, so a NotSupportedException is the loud signal we want.
    public Task AddFarmAsync(ShramSafal.Domain.Farms.Farm farm, CancellationToken ct = default) => throw new NotSupportedException();
    public Task AddFarmBoundaryAsync(ShramSafal.Domain.Farms.FarmBoundary boundary, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<ShramSafal.Domain.Farms.Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task AddFarmMembershipAsync(ShramSafal.Domain.Farms.FarmMembership membership, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<ShramSafal.Domain.Farms.FarmMembership?> GetFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<AgriSync.SharedKernel.Contracts.Roles.AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<bool> IsUserOwnerOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task AddPlotAsync(ShramSafal.Domain.Farms.Plot plot, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<ShramSafal.Domain.Farms.Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<ShramSafal.Domain.Farms.Plot>> GetPlotsByFarmIdAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task AddCropCycleAsync(ShramSafal.Domain.Crops.CropCycle cropCycle, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<ShramSafal.Domain.Crops.CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<ShramSafal.Domain.Crops.CropCycle>> GetCropCyclesByPlotIdAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task AddDailyLogAsync(ShramSafal.Domain.Logs.DailyLog log, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<ShramSafal.Domain.Logs.DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<ShramSafal.Domain.Logs.DailyLog?> GetDailyLogByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default) => throw new NotSupportedException();
    public Task AddCostEntryAsync(ShramSafal.Domain.Finance.CostEntry costEntry, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<ShramSafal.Domain.Finance.CostEntry?> GetCostEntryByIdAsync(Guid costEntryId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<ShramSafal.Domain.Finance.CostEntry>> GetCostEntriesByIdsAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<ShramSafal.Domain.Finance.CostEntry>> GetCostEntriesForDuplicateCheck(AgriSync.SharedKernel.Contracts.Ids.FarmId farmId, Guid? plotId, string category, DateTime since, CancellationToken ct = default) => throw new NotSupportedException();
    public Task AddFinanceCorrectionAsync(ShramSafal.Domain.Finance.FinanceCorrection correction, CancellationToken ct = default) => throw new NotSupportedException();
    public Task AddDayLedgerAsync(ShramSafal.Domain.Finance.DayLedger dayLedger, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<ShramSafal.Domain.Finance.DayLedger?> GetDayLedgerByIdAsync(Guid dayLedgerId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<ShramSafal.Domain.Finance.DayLedger?> GetDayLedgerBySourceCostEntryIdAsync(Guid costEntryId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<ShramSafal.Domain.Finance.DayLedger>> GetDayLedgersForFarm(Guid farmId, DateOnly from, DateOnly to, CancellationToken ct = default) => throw new NotSupportedException();
    public Task AddAttachmentAsync(ShramSafal.Domain.Attachments.Attachment attachment, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<ShramSafal.Domain.Attachments.Attachment?> GetAttachmentByIdAsync(Guid attachmentId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<ShramSafal.Domain.Attachments.Attachment>> GetAttachmentsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default) => throw new NotSupportedException();
    public Task AddPriceConfigAsync(ShramSafal.Domain.Finance.PriceConfig config, CancellationToken ct = default) => throw new NotSupportedException();
    public Task AddAuditEventAsync(ShramSafal.Domain.Audit.AuditEvent auditEvent, CancellationToken ct = default) => throw new NotSupportedException();
    public Task AddScheduleTemplateAsync(ShramSafal.Domain.Planning.ScheduleTemplate template, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<ShramSafal.Domain.Planning.ScheduleTemplate>> GetScheduleTemplatesAsync(CancellationToken ct = default) => throw new NotSupportedException();
    public Task AddPlannedActivitiesAsync(IEnumerable<ShramSafal.Domain.Planning.PlannedActivity> plannedActivities, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<ShramSafal.Domain.Planning.PlannedActivity?> GetPlannedActivityByIdAsync(Guid id, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<ShramSafal.Domain.Planning.PlannedActivity>> GetPlannedActivitiesByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<ShramSafal.Domain.Logs.LogTask>> GetExecutedTasksByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<ShramSafal.Domain.Finance.CostEntry>> GetCostEntriesAsync(DateOnly? fromDate, DateOnly? toDate, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<ShramSafal.Domain.Finance.FinanceCorrection>> GetCorrectionsForEntriesAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<ShramSafal.Domain.Farms.Farm>> GetFarmsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<ShramSafal.Domain.Farms.Plot>> GetPlotsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<ShramSafal.Domain.Crops.CropCycle>> GetCropCyclesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<ShramSafal.Domain.Logs.DailyLog>> GetDailyLogsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<ShramSafal.Domain.Finance.CostEntry>> GetCostEntriesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<ShramSafal.Domain.Finance.FinanceCorrection>> GetFinanceCorrectionsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<ShramSafal.Domain.Finance.DayLedger>> GetDayLedgersChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<ShramSafal.Domain.Finance.PriceConfig>> GetPriceConfigsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<ShramSafal.Domain.Planning.PlannedActivity>> GetPlannedActivitiesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<ShramSafal.Domain.Attachments.Attachment>> GetAttachmentsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<ShramSafal.Domain.Audit.AuditEvent>> GetAuditEventsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<ShramSafal.Domain.Audit.AuditEvent>> GetAuditEventsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<ShramSafal.Domain.Audit.AuditEvent>> GetAuditEventsForFarmAsync(Guid farmId, DateOnly from, DateOnly to, int limit, int offset, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<IReadOnlyList<ShramSafal.Application.Contracts.Dtos.SyncOperatorDto>> GetOperatorsByIdsAsync(IEnumerable<Guid> userIds, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<int> CountActivePrimaryOwnersAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task AddCropScheduleTemplateAsync(ShramSafal.Domain.Schedules.CropScheduleTemplate template, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<ShramSafal.Domain.Schedules.CropScheduleTemplate?> GetCropScheduleTemplateByIdAsync(AgriSync.SharedKernel.Contracts.Ids.ScheduleTemplateId templateId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<ShramSafal.Domain.Schedules.CropScheduleTemplate>> GetCropScheduleTemplatesForCropAsync(string cropKey, string? regionCode, CancellationToken ct = default) => throw new NotSupportedException();
    public Task AddScheduleSubscriptionAsync(ShramSafal.Domain.Schedules.ScheduleSubscription subscription, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<ShramSafal.Domain.Schedules.ScheduleSubscription?> GetScheduleSubscriptionByIdAsync(AgriSync.SharedKernel.Contracts.Ids.ScheduleSubscriptionId subscriptionId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<ShramSafal.Domain.Schedules.ScheduleSubscription?> GetActiveScheduleSubscriptionAsync(Guid plotId, string cropKey, Guid cropCycleId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task AddScheduleMigrationEventAsync(ShramSafal.Domain.Schedules.ScheduleMigrationEvent migrationEvent, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<ShramSafal.Domain.Planning.ScheduleTemplate?> GetScheduleTemplateByIdAsync(Guid templateId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<bool> HasActiveOwnerMembershipAsync(Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<ShramSafal.Domain.Planning.ScheduleTemplate>> GetScheduleLineageAsync(Guid rootTemplateId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    public Task<int> GetDisputedLogCountForPlotAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task AddJobCardAsync(ShramSafal.Domain.Work.JobCard jobCard, CancellationToken ct = default) => throw new NotSupportedException();
    public Task AddTranscriptAsync(ShramSafal.Domain.AI.Transcript transcript, CancellationToken ct = default) => Task.CompletedTask;
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
    private readonly Queue<IReadOnlyList<string>> _streamChunks = new();

    public AiProviderType ProviderType { get; } = providerType;

    public int VoiceParseCallCount { get; private set; }
    public int VoiceStreamCallCount { get; private set; }

    public void EnqueueVoiceResult(VoiceParseCanonicalResult result)
    {
        _voiceResults.Enqueue(result);
    }

    public void EnqueueStreamChunks(params string[] chunks)
    {
        _streamChunks.Enqueue(chunks);
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

    public async IAsyncEnumerable<string> ParseVoiceStreamAsync(
        string transcript,
        string systemPrompt,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        VoiceStreamCallCount++;
        var chunks = _streamChunks.TryDequeue(out var queued)
            ? queued
            : ["{}"];

        foreach (var chunk in chunks)
        {
            ct.ThrowIfCancellationRequested();
            await Task.Yield();
            yield return chunk;
        }
    }
}
