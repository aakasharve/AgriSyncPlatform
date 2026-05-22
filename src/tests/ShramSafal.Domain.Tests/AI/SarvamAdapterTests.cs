using System.Net;
using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using ShramSafal.Infrastructure.AI;
using ShramSafal.Infrastructure.Integrations.Sarvam;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

public sealed class SarvamAdapterTests
{
    [Fact]
    public async Task SttClient_FormatsMultipartRequestCorrectly()
    {
        HttpRequestMessage? capturedRequest = null;
        string? capturedBody = null;

        var handler = new StubHttpMessageHandler(request =>
        {
            capturedRequest = request;
            capturedBody = request.Content is null
                ? null
                : request.Content.ReadAsStringAsync(CancellationToken.None).GetAwaiter().GetResult();

            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"transcript\":\"नमस्कार\",\"language_code\":\"mr-IN\"}", Encoding.UTF8, "application/json")
            };
        });

        var client = new HttpClient(handler);
        var options = Options.Create(CreateOptions());
        var stt = new SarvamSttClient(
            options,
            new StaticHttpClientFactory(client),
            NullLogger<SarvamSttClient>.Instance);

        await using var stream = new MemoryStream([0x10, 0x20, 0x30, 0x40]);
        var result = await stt.TranscribeAsync(stream, "audio/webm", "mr-IN", CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("नमस्कार", result.Transcript);
        Assert.NotNull(capturedRequest);
        Assert.Equal(HttpMethod.Post, capturedRequest!.Method);
        Assert.Equal("k-test", capturedRequest.Headers.GetValues("api-subscription-key").Single());
        Assert.NotNull(capturedRequest.Content);
        Assert.Equal("multipart/form-data", capturedRequest.Content!.Headers.ContentType?.MediaType);
        Assert.Contains("name=file", capturedBody ?? string.Empty, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("name=model", capturedBody ?? string.Empty, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("name=language_code", capturedBody ?? string.Empty, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("name=mode", capturedBody ?? string.Empty, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ChatClient_FormatsJsonBodyCorrectly()
    {
        string? capturedBody = null;
        HttpRequestMessage? capturedRequest = null;

        var handler = new StubHttpMessageHandler(request =>
        {
            capturedRequest = request;
            capturedBody = request.Content is null
                ? null
                : request.Content.ReadAsStringAsync(CancellationToken.None).GetAwaiter().GetResult();

            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    "{\"choices\":[{\"message\":{\"content\":\"{\\\"summary\\\":\\\"ok\\\"}\"}}]}",
                    Encoding.UTF8,
                    "application/json")
            };
        });

        var client = new HttpClient(handler);
        var options = Options.Create(CreateOptions());
        var chat = new SarvamChatClient(
            options,
            new StaticHttpClientFactory(client),
            NullLogger<SarvamChatClient>.Instance);

        var result = await chat.CompleteAsync("system prompt", "user message", CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(capturedRequest);
        Assert.Equal("k-test", capturedRequest!.Headers.GetValues("api-subscription-key").Single());
        Assert.Contains("\"model\":\"sarvam-m-test\"", capturedBody ?? string.Empty, StringComparison.Ordinal);
        Assert.Contains("\"role\":\"system\"", capturedBody ?? string.Empty, StringComparison.Ordinal);
        Assert.Contains("\"role\":\"user\"", capturedBody ?? string.Empty, StringComparison.Ordinal);
        Assert.Contains("system prompt", capturedBody ?? string.Empty, StringComparison.Ordinal);
        Assert.Contains("user message", capturedBody ?? string.Empty, StringComparison.Ordinal);
    }

    [Fact]
    public async Task SarvamProvider_ChainsSttThenChatForVoiceFlow()
    {
        var callOrder = new List<string>();

        var handler = new StubHttpMessageHandler(request =>
        {
            var uri = request.RequestUri?.AbsoluteUri ?? string.Empty;
            callOrder.Add(uri);

            if (uri.Contains("/stt", StringComparison.OrdinalIgnoreCase))
            {
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("{\"transcript\":\"आज काम केले\",\"language_code\":\"mr-IN\"}", Encoding.UTF8, "application/json")
                };
            }

            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    """
                    {
                      "choices": [
                        {
                          "message": {
                            "content": "{\"summary\":\"ok\",\"dayOutcome\":\"WORK_RECORDED\",\"cropActivities\":[],\"irrigation\":[],\"labour\":[],\"inputs\":[],\"machinery\":[],\"activityExpenses\":[],\"observations\":[],\"plannedTasks\":[],\"missingSegments\":[],\"unclearSegments\":[],\"questionsForUser\":[],\"fieldConfidences\":{},\"confidence\":0.82,\"fullTranscript\":\"आज काम केले\"}"
                          }
                        }
                      ]
                    }
                    """,
                    Encoding.UTF8,
                    "application/json")
            };
        });

        var client = new HttpClient(handler);
        var options = Options.Create(CreateOptions());
        var factory = new StaticHttpClientFactory(client);
        var stt = new SarvamSttClient(options, factory, NullLogger<SarvamSttClient>.Instance);
        var chat = new SarvamChatClient(options, factory, NullLogger<SarvamChatClient>.Instance);
        var vision = new SarvamVisionClient(options, factory, NullLogger<SarvamVisionClient>.Instance);
        var provider = new SarvamAiProvider(
            stt,
            chat,
            vision,
            options,
            new AiResponseNormalizer(),
            NullLogger<SarvamAiProvider>.Instance);

        await using var stream = new MemoryStream([0x10, 0x20, 0x30, 0x40]);
        var result = await provider.ParseVoiceAsync(
            stream,
            "audio/webm",
            "mr-IN",
            "system prompt",
            CancellationToken.None);

        Assert.True(result.Success);
        Assert.Equal("आज काम केले", result.RawTranscript);
        Assert.NotNull(result.NormalizedJson);
        Assert.Equal(2, callOrder.Count);
        Assert.Contains("/stt", callOrder[0], StringComparison.OrdinalIgnoreCase);
        Assert.Contains("/chat", callOrder[1], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void SarvamProvider_OnlyParticipatesInVoiceRouting()
    {
        var options = Options.Create(CreateOptions());
        var factory = new StaticHttpClientFactory(new HttpClient(new StubHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.OK))));
        var provider = new SarvamAiProvider(
            new SarvamSttClient(options, factory, NullLogger<SarvamSttClient>.Instance),
            new SarvamChatClient(options, factory, NullLogger<SarvamChatClient>.Instance),
            new SarvamVisionClient(options, factory, NullLogger<SarvamVisionClient>.Instance),
            options,
            new AiResponseNormalizer(),
            NullLogger<SarvamAiProvider>.Instance);

        Assert.True(provider.CanHandle(ShramSafal.Domain.AI.AiOperationType.VoiceToStructuredLog));
        Assert.False(provider.CanHandle(ShramSafal.Domain.AI.AiOperationType.ReceiptToExpenseItems));
        Assert.False(provider.CanHandle(ShramSafal.Domain.AI.AiOperationType.PattiImageToSaleData));
    }

    [Fact]
    public void StreamingSttClient_BuildsHeaderSafeUrl()
    {
        var options = CreateOptions();
        options.StreamingSttEndpoint = "wss://unit.test/speech-to-text/ws";
        options.StreamingSttModel = "saaras:v3";
        options.StreamingSttMode = "codemix";
        options.StreamingSttLanguage = "mr-IN";
        options.StreamingSampleRate = 16000;
        options.StreamingInputAudioCodec = "wav";
        options.StreamingHighVadSensitivity = true;
        options.StreamingVadSignals = true;
        options.StreamingFlushSignal = true;

        var uri = SarvamStreamingSttClient.BuildStreamingUri(options);
        var headers = SarvamStreamingSttClient.BuildHeaders(options);

        Assert.Equal("wss://unit.test/speech-to-text/ws", uri.GetLeftPart(UriPartial.Path));
        Assert.Contains("language-code=mr-IN", uri.Query, StringComparison.Ordinal);
        Assert.Contains("model=saaras%3Av3", uri.Query, StringComparison.Ordinal);
        Assert.Contains("mode=codemix", uri.Query, StringComparison.Ordinal);
        Assert.Contains("sample_rate=16000", uri.Query, StringComparison.Ordinal);
        Assert.Contains("input_audio_codec=wav", uri.Query, StringComparison.Ordinal);
        Assert.Contains("high_vad_sensitivity=true", uri.Query, StringComparison.Ordinal);
        Assert.Contains("vad_signals=true", uri.Query, StringComparison.Ordinal);
        Assert.Contains("flush_signal=true", uri.Query, StringComparison.Ordinal);
        Assert.DoesNotContain("k-test", uri.AbsoluteUri, StringComparison.Ordinal);
        Assert.Equal("k-test", headers["Api-Subscription-Key"]);
    }

    [Fact]
    public async Task StreamingSttClient_RejectsUnsupportedWebmMimeOnStreamingPath()
    {
        // SARVAM_PRIMARY_VOICE_PIPELINE Task 2.1 — the format guard moved
        // onto TranscribeStreamAsync (the WebSocket path) and now fails
        // fast with SarvamAudioFormatUnsupportedException. The REST path
        // (TranscribeAsync) accepts arbitrary MIME types because the
        // server-side audio transcoder runs upstream in production.
        var options = Options.Create(CreateOptions());
        var factory = new StaticHttpClientFactory(
            new HttpClient(new StubHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.OK))));
        var restClient = new SarvamSttClient(options, factory, NullLogger<SarvamSttClient>.Instance);
        var client = new SarvamStreamingSttClient(
            options,
            NullLogger<SarvamStreamingSttClient>.Instance,
            restClient,
            new FakeTranscriptRepo());

        await using var stream = new MemoryStream([0x10, 0x20]);

        var ex = await Assert.ThrowsAsync<SarvamAudioFormatUnsupportedException>(async () =>
        {
            await foreach (var _ in client.TranscribeStreamAsync(
                stream,
                "audio/webm",
                "mr-IN",
                "codemix",
                CancellationToken.None))
            {
                // unreachable — guard throws before yielding
            }
        });

        Assert.Equal("audio/webm", ex.MimeType);
        Assert.Contains("WAV or raw PCM", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task StreamingSttClient_TranscribeAsyncReturnsCachedTranscriptOnIdempotencyHit()
    {
        // SARVAM_PRIMARY_VOICE_PIPELINE Task 2.10 — second call with
        // identical bytes hits transcript_history and never reaches
        // Sarvam. Asserts the HTTP factory was NOT touched on the
        // cached path.
        var options = Options.Create(CreateOptions());
        var callCount = 0;
        var factory = new StaticHttpClientFactory(new HttpClient(new StubHttpMessageHandler(_ =>
        {
            callCount++;
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    "{\"transcript\":\"नमस्कार\",\"language_code\":\"mr-IN\"}",
                    Encoding.UTF8,
                    "application/json")
            };
        })));
        var restClient = new SarvamSttClient(options, factory, NullLogger<SarvamSttClient>.Instance);
        var repo = new FakeTranscriptRepo();
        var client = new SarvamStreamingSttClient(
            options,
            NullLogger<SarvamStreamingSttClient>.Instance,
            restClient,
            repo);

        var payload = new byte[] { 0x10, 0x20, 0x30, 0x40 };

        // First call — miss; reaches Sarvam REST exactly once, persists
        // a transcript_history row.
        await using (var stream1 = new MemoryStream(payload))
        {
            var first = await client.TranscribeAsync(
                stream1,
                "audio/wav",
                "mr-IN",
                "codemix",
                CancellationToken.None);
            Assert.True(first.Success);
            Assert.Equal("नमस्कार", first.Transcript);
        }

        Assert.Equal(1, callCount);
        Assert.Single(repo.Persisted);

        // Second call — hit; never reaches Sarvam. callCount stays at 1.
        await using (var stream2 = new MemoryStream(payload))
        {
            var second = await client.TranscribeAsync(
                stream2,
                "audio/wav",
                "mr-IN",
                "codemix",
                CancellationToken.None);
            Assert.True(second.Success);
            Assert.Equal("नमस्कार", second.Transcript);
        }

        Assert.Equal(1, callCount);
        Assert.Single(repo.Persisted);
    }

    [Fact]
    public async Task VerbatimSttClient_SecondCallWithSameContentHashSkipsSarvam()
    {
        // SARVAM_PRIMARY_VOICE_PIPELINE Task 2.2 — verbatim D-MOAT
        // sampling is REST-only and shares the same transcript_history
        // idempotency contract. Two calls with the same content hash
        // result in ONE Sarvam HTTP call.
        var options = Options.Create(CreateOptions());
        var callCount = 0;
        var factory = new StaticHttpClientFactory(new HttpClient(new StubHttpMessageHandler(_ =>
        {
            callCount++;
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    "{\"transcript\":\"verbatim text\",\"language_code\":\"mr-IN\"}",
                    Encoding.UTF8,
                    "application/json")
            };
        })));
        var repo = new FakeTranscriptRepo();
        var client = new SarvamVerbatimSttClient(
            options,
            factory,
            NullLogger<SarvamVerbatimSttClient>.Instance,
            repo);

        var payload = new byte[] { 0x10, 0x20, 0x30, 0x40 };
        const string hash = "abc"; // pre-computed by caller; client honors when non-empty

        await using (var stream1 = new MemoryStream(payload))
        {
            var first = await client.TranscribeVerbatimAsync(
                stream1,
                "audio/wav",
                "mr-IN",
                hash,
                CancellationToken.None);
            Assert.True(first.IsSuccess);
            Assert.Equal("verbatim text", first.Transcript);
        }

        Assert.Equal(1, callCount);
        Assert.Single(repo.Persisted);

        await using (var stream2 = new MemoryStream(payload))
        {
            var second = await client.TranscribeVerbatimAsync(
                stream2,
                "audio/wav",
                "mr-IN",
                hash,
                CancellationToken.None);
            Assert.True(second.IsSuccess);
            Assert.Equal("verbatim text", second.Transcript);
        }

        Assert.Equal(1, callCount); // unchanged — second call hit cache
        Assert.Single(repo.Persisted);
    }

    [Fact]
    public async Task StreamingSttClient_TranscribeStreamYieldsPartialsFromMockSocket()
    {
        // SARVAM_PRIMARY_VOICE_PIPELINE Task 2.1 — partial-transcript
        // emission. Validates the message-extraction pipeline (the same
        // TryExtractTranscript path the WebSocket loop uses) yields one
        // string per {"type":"transcript","text":"..."} envelope and
        // skips speech_start / speech_end VAD signals. Driving a real
        // ClientWebSocket against a mocked endpoint requires a process-
        // local WebSocket server (TestServer + Kestrel) which the unit
        // suite intentionally avoids; the production WebSocket loop is
        // exercised by the integration-test suite in Task 2.3.
        await Task.CompletedTask; // honors async signature

        var sequence = new[]
        {
            "{\"type\":\"speech_start\"}",
            "{\"type\":\"transcript\",\"text\":\"आज\"}",
            "{\"type\":\"transcript\",\"text\":\"काम\"}",
            "{\"type\":\"transcript\",\"text\":\"केले\"}",
            "{\"type\":\"speech_end\"}"
        };

        var partials = new List<string>();
        foreach (var message in sequence)
        {
            if (SarvamStreamingSttClient.TryExtractTranscript(message, out var transcript))
            {
                partials.Add(transcript);
            }
        }

        Assert.Equal(new[] { "आज", "काम", "केले" }, partials);
    }

    [Theory]
    [InlineData("{\"type\":\"data\",\"data\":{\"transcript\":\"आज काम केले\"}}", "आज काम केले")]
    [InlineData("{\"type\":\"transcript\",\"text\":\"today work done\"}", "today work done")]
    [InlineData("{\"type\":\"transcript\",\"transcript\":\"नमस्कार\"}", "नमस्कार")]
    public void StreamingSttClient_ParsesTranscriptResponses(string responseBody, string expectedTranscript)
    {
        var parsed = SarvamStreamingSttClient.TryExtractTranscript(responseBody, out var transcript);

        Assert.True(parsed);
        Assert.Equal(expectedTranscript, transcript);
    }

    [Theory]
    [InlineData("{\"type\":\"speech_start\"}")]
    [InlineData("{\"type\":\"speech_end\"}")]
    public void StreamingSttClient_TreatsVadSignalsAsNonTerminal(string responseBody)
    {
        var parsed = SarvamStreamingSttClient.TryExtractTranscript(responseBody, out var transcript);

        Assert.False(parsed);
        Assert.Equal(string.Empty, transcript);
    }

    private static SarvamOptions CreateOptions()
    {
        return new SarvamOptions
        {
            ApiSubscriptionKey = "k-test",
            SttEndpoint = "https://unit.test/stt",
            SttModel = "saaras:test",
            SttMode = "transcribe",
            SttLanguage = "mr-IN",
            ChatEndpoint = "https://unit.test/chat",
            ChatModel = "sarvam-m-test",
            VisionModel = "sarvam-vision-test",
            TimeoutSeconds = 5
        };
    }
}

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE Task 2.10 test fixture — minimal
/// transcript_history backing store. Overrides only the two new methods;
/// every other <see cref="ShramSafal.Application.Ports.IShramSafalRepository"/>
/// member falls back to the default impl declared on the port (no-op for
/// writes, empty for reads).
/// </summary>
internal sealed class FakeTranscriptRepo : ShramSafal.Application.Ports.IShramSafalRepository
{
    public List<ShramSafal.Domain.AI.TranscriptHistory> Persisted { get; } = new();

    public Task<ShramSafal.Domain.AI.TranscriptHistory?> GetTranscriptHistoryAsync(
        string audioContentHash,
        string transcriptProvider,
        string transcriptModelVersion,
        string transcriptMode,
        CancellationToken ct = default)
    {
        var hit = Persisted.FirstOrDefault(p =>
            p.AudioContentHash == audioContentHash &&
            p.TranscriptProvider == transcriptProvider &&
            p.TranscriptModelVersion == transcriptModelVersion &&
            p.TranscriptMode == transcriptMode);
        return Task.FromResult(hit);
    }

    public Task UpsertTranscriptHistoryAsync(
        ShramSafal.Domain.AI.TranscriptHistory history,
        CancellationToken ct = default)
    {
        var exists = Persisted.Any(p =>
            p.AudioContentHash == history.AudioContentHash &&
            p.TranscriptProvider == history.TranscriptProvider &&
            p.TranscriptModelVersion == history.TranscriptModelVersion &&
            p.TranscriptMode == history.TranscriptMode);

        if (!exists)
        {
            Persisted.Add(history);
        }

        return Task.CompletedTask;
    }

    // Required (non-default) members on IShramSafalRepository — keep as
    // throwing stubs so a test that accidentally exercises these paths
    // surfaces clearly rather than silently no-opping. The new
    // SarvamStreamingSttClient / SarvamVerbatimSttClient call sites only
    // touch the two methods overridden above.
    public Task AddFarmAsync(ShramSafal.Domain.Farms.Farm farm, CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddFarmBoundaryAsync(ShramSafal.Domain.Farms.FarmBoundary boundary, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<ShramSafal.Domain.Farms.Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddFarmMembershipAsync(ShramSafal.Domain.Farms.FarmMembership membership, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<ShramSafal.Domain.Farms.FarmMembership?> GetFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<AgriSync.SharedKernel.Contracts.Roles.AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<bool> IsUserOwnerOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddPlotAsync(ShramSafal.Domain.Farms.Plot plot, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<ShramSafal.Domain.Farms.Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<ShramSafal.Domain.Farms.Plot>> GetPlotsByFarmIdAsync(Guid farmId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddCropCycleAsync(ShramSafal.Domain.Crops.CropCycle cropCycle, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<ShramSafal.Domain.Crops.CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<ShramSafal.Domain.Crops.CropCycle>> GetCropCyclesByPlotIdAsync(Guid plotId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddDailyLogAsync(ShramSafal.Domain.Logs.DailyLog log, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<ShramSafal.Domain.Logs.DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<ShramSafal.Domain.Logs.DailyLog?> GetDailyLogByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddCostEntryAsync(ShramSafal.Domain.Finance.CostEntry costEntry, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<ShramSafal.Domain.Finance.CostEntry?> GetCostEntryByIdAsync(Guid costEntryId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<ShramSafal.Domain.Finance.CostEntry>> GetCostEntriesByIdsAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<ShramSafal.Domain.Finance.CostEntry>> GetCostEntriesForDuplicateCheck(AgriSync.SharedKernel.Contracts.Ids.FarmId farmId, Guid? plotId, string category, DateTime since, CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddFinanceCorrectionAsync(ShramSafal.Domain.Finance.FinanceCorrection correction, CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddDayLedgerAsync(ShramSafal.Domain.Finance.DayLedger dayLedger, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<ShramSafal.Domain.Finance.DayLedger?> GetDayLedgerByIdAsync(Guid dayLedgerId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<ShramSafal.Domain.Finance.DayLedger?> GetDayLedgerBySourceCostEntryIdAsync(Guid costEntryId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<ShramSafal.Domain.Finance.DayLedger>> GetDayLedgersForFarm(Guid farmId, DateOnly from, DateOnly to, CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddAttachmentAsync(ShramSafal.Domain.Attachments.Attachment attachment, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<ShramSafal.Domain.Attachments.Attachment?> GetAttachmentByIdAsync(Guid attachmentId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<ShramSafal.Domain.Attachments.Attachment>> GetAttachmentsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddPriceConfigAsync(ShramSafal.Domain.Finance.PriceConfig config, CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddAuditEventAsync(ShramSafal.Domain.Audit.AuditEvent auditEvent, CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddScheduleTemplateAsync(ShramSafal.Domain.Planning.ScheduleTemplate template, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<ShramSafal.Domain.Planning.ScheduleTemplate>> GetScheduleTemplatesAsync(CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddPlannedActivitiesAsync(IEnumerable<ShramSafal.Domain.Planning.PlannedActivity> plannedActivities, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<ShramSafal.Domain.Planning.PlannedActivity?> GetPlannedActivityByIdAsync(Guid id, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<ShramSafal.Domain.Planning.PlannedActivity>> GetPlannedActivitiesByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<ShramSafal.Domain.Logs.LogTask>> GetExecutedTasksByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<ShramSafal.Domain.Finance.CostEntry>> GetCostEntriesAsync(DateOnly? fromDate, DateOnly? toDate, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<ShramSafal.Domain.Finance.FinanceCorrection>> GetCorrectionsForEntriesAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<ShramSafal.Domain.Farms.Farm>> GetFarmsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<ShramSafal.Domain.Farms.Plot>> GetPlotsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<ShramSafal.Domain.Crops.CropCycle>> GetCropCyclesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<ShramSafal.Domain.Logs.DailyLog>> GetDailyLogsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<ShramSafal.Domain.Finance.CostEntry>> GetCostEntriesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<ShramSafal.Domain.Finance.FinanceCorrection>> GetFinanceCorrectionsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<ShramSafal.Domain.Finance.DayLedger>> GetDayLedgersChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<ShramSafal.Domain.Finance.PriceConfig>> GetPriceConfigsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<ShramSafal.Domain.Planning.PlannedActivity>> GetPlannedActivitiesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<ShramSafal.Domain.Attachments.Attachment>> GetAttachmentsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<ShramSafal.Domain.Audit.AuditEvent>> GetAuditEventsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<ShramSafal.Domain.Audit.AuditEvent>> GetAuditEventsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<ShramSafal.Domain.Audit.AuditEvent>> GetAuditEventsForFarmAsync(Guid farmId, DateOnly from, DateOnly to, int limit, int offset, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<IReadOnlyList<ShramSafal.Application.Contracts.Dtos.SyncOperatorDto>> GetOperatorsByIdsAsync(IEnumerable<Guid> userIds, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<int> CountActivePrimaryOwnersAsync(Guid farmId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddCropScheduleTemplateAsync(ShramSafal.Domain.Schedules.CropScheduleTemplate template, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<ShramSafal.Domain.Schedules.CropScheduleTemplate?> GetCropScheduleTemplateByIdAsync(AgriSync.SharedKernel.Contracts.Ids.ScheduleTemplateId templateId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<ShramSafal.Domain.Schedules.CropScheduleTemplate>> GetCropScheduleTemplatesForCropAsync(string cropKey, string? regionCode, CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddScheduleSubscriptionAsync(ShramSafal.Domain.Schedules.ScheduleSubscription subscription, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<ShramSafal.Domain.Schedules.ScheduleSubscription?> GetScheduleSubscriptionByIdAsync(AgriSync.SharedKernel.Contracts.Ids.ScheduleSubscriptionId subscriptionId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<ShramSafal.Domain.Schedules.ScheduleSubscription?> GetActiveScheduleSubscriptionAsync(Guid plotId, string cropKey, Guid cropCycleId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddScheduleMigrationEventAsync(ShramSafal.Domain.Schedules.ScheduleMigrationEvent migrationEvent, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<ShramSafal.Domain.Planning.ScheduleTemplate?> GetScheduleTemplateByIdAsync(Guid templateId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<bool> HasActiveOwnerMembershipAsync(Guid userId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<ShramSafal.Domain.Planning.ScheduleTemplate>> GetScheduleLineageAsync(Guid rootTemplateId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    public Task<int> GetDisputedLogCountForPlotAsync(Guid plotId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddJobCardAsync(ShramSafal.Domain.Work.JobCard jobCard, CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddTranscriptAsync(ShramSafal.Domain.AI.Transcript transcript, CancellationToken ct = default) => throw new NotImplementedException();
}
