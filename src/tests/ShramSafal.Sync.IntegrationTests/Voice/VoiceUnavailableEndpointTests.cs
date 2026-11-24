// spec: voice-instant-phase-a-2026-11-23 (Task 0 header on the wire, S6 failure status) - the voice-parse endpoint with
// the REAL orchestrator, handler and endpoint, Sarvam as transcriber and as sorter, and every provider faked.
//
// In-memory only (EF InMemory + TestServer), the same pattern as AiEndpointsTests: no Postgres, no Sarvam, no Gemini.
// Authored from the acceptance criteria only.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks;
using AgriSync.BuildingBlocks.Analytics;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ShramSafal.Api;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.AI;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Voice;

public sealed class VoiceUnavailableEndpointTests
{
    private static readonly Guid TestUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");

    private const string Transcript = "आज पाच मजुरांनी द्राक्षाला पाणी दिलं.";

    private static readonly Regex TimingShape = new(
        "^s3;dur=[0-9]+, stt;dur=[0-9]+, struct;dur=[0-9]+, total;dur=[0-9]+$",
        RegexOptions.CultureInvariant);

    // =====================================================================================================
    // The Server-Timing header is on the real response
    // =====================================================================================================

    [Fact]
    public async Task A_voice_note_that_parses_answers_200_with_a_well_formed_Server_Timing_header()
    {
        await using var host = await Host.CreateAsync(sorter: Sorter.Good, transcriber: Stt.Words);
        var farmId = await host.CreateFarmAsync("timing-1");

        var response = await host.PostAudioAsync(farmId, "timing-key-1");

        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, body);
        Assert.True(response.Headers.TryGetValues("Server-Timing", out var values), "no Server-Timing header on the response");
        var header = Assert.Single(values!);
        Assert.Matches(TimingShape, header);
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("Sarvam", doc.RootElement.GetProperty("providerUsed").GetString());
        Assert.False(doc.RootElement.GetProperty("fallbackUsed").GetBoolean());
        // Saaras then Sarvam sorting on the words; Gemini never asked.
        Assert.Equal(1, host.Transcriber.Calls);
        Assert.Equal(1, host.Sarvam.VoiceCalls);
        Assert.Equal("text/plain", host.Sarvam.LastMime);
        Assert.Equal(0, host.Gemini.VoiceCalls);
    }

    [Fact]
    public async Task A_typed_note_also_carries_the_header()
    {
        await using var host = await Host.CreateAsync(sorter: Sorter.Good, transcriber: Stt.Words);
        var farmId = await host.CreateFarmAsync("timing-2");

        var response = await host.Client.PostAsJsonAsync("/shramsafal/ai/voice-parse", new
        {
            farmId,
            textTranscript = "आज पाणी दिलं.",
            idempotencyKey = "timing-key-2",
        });

        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        Assert.True(response.Headers.TryGetValues("Server-Timing", out var values));
        Assert.Matches(TimingShape, Assert.Single(values!));
        Assert.Equal(0, host.Transcriber.Calls); // text is not sent to speech-to-text
    }

    // =====================================================================================================
    // Nobody else can take voice: a failure is a 503 the phone retries, not a 400 that means "your input is wrong"
    // =====================================================================================================

    [Fact]
    public async Task When_speech_to_text_is_unreachable_the_answer_is_503_with_the_voice_unavailable_code_and_the_audio_is_kept()
    {
        await using var host = await Host.CreateAsync(sorter: Sorter.Good, transcriber: Stt.Throws);
        var farmId = await host.CreateFarmAsync("503-1");

        var response = await host.PostAudioAsync(farmId, "unavailable-key-1");

        await AssertUnavailableAsync(response);
        Assert.Equal(1, host.Transcriber.Calls);
        Assert.Equal(0, host.Sarvam.VoiceCalls); // no second Sarvam run with the recording
        Assert.Equal(0, host.Gemini.VoiceCalls);
        var job = await host.SingleJobAsync();
        Assert.Equal(AiJobStatus.Failed, job.Status);
        Assert.False(string.IsNullOrWhiteSpace(job.RawInputRef), "the raw audio reference must be kept on the failed job");
    }

    [Fact]
    public async Task When_the_transcript_comes_back_empty_the_answer_is_503()
    {
        await using var host = await Host.CreateAsync(sorter: Sorter.Good, transcriber: Stt.Empty);
        var farmId = await host.CreateFarmAsync("503-2");

        var response = await host.PostAudioAsync(farmId, "unavailable-key-2");

        await AssertUnavailableAsync(response);
        Assert.Equal(0, host.Sarvam.VoiceCalls);
        Assert.Equal(AiJobStatus.Failed, (await host.SingleJobAsync()).Status);
    }

    [Fact]
    public async Task When_a_piece_of_a_long_recording_fails_the_answer_is_503()
    {
        await using var host = await Host.CreateAsync(sorter: Sorter.Good, transcriber: Stt.PartFailed);
        var farmId = await host.CreateFarmAsync("503-3");

        var response = await host.PostAudioAsync(farmId, "unavailable-key-3");

        await AssertUnavailableAsync(response);
        Assert.Equal(0, host.Sarvam.VoiceCalls);
    }

    [Fact]
    public async Task When_sorting_fails_the_answer_is_503_the_transcript_and_audio_are_kept_and_the_words_alone_were_retried()
    {
        await using var host = await Host.CreateAsync(sorter: Sorter.Transient, transcriber: Stt.Words);
        var farmId = await host.CreateFarmAsync("503-4");

        var response = await host.PostAudioAsync(farmId, "unavailable-key-4");

        await AssertUnavailableAsync(response);
        Assert.Equal(1, host.Transcriber.Calls); // never transcribed again
        Assert.Equal(0, host.Gemini.VoiceCalls);
        Assert.All(host.Sarvam.Mimes, mime => Assert.Equal("text/plain", mime));
        var job = await host.SingleJobAsync();
        Assert.Equal(AiJobStatus.Failed, job.Status);
        Assert.False(string.IsNullOrWhiteSpace(job.RawInputRef));
        Assert.Equal(Transcript, job.TranscriptCodemix);
    }

    [Fact]
    public async Task The_same_recording_sent_again_after_a_503_is_parsed_on_the_same_job()
    {
        await using var host = await Host.CreateAsync(sorter: Sorter.Good, transcriber: Stt.FailsOnceThenWords);
        var farmId = await host.CreateFarmAsync("503-resend");

        var first = await host.PostAudioAsync(farmId, "resend-key");
        await AssertUnavailableAsync(first);
        var jobId = (await host.SingleJobAsync()).Id;

        var second = await host.PostAudioAsync(farmId, "resend-key");

        var body = await second.Content.ReadAsStringAsync();
        Assert.True(second.IsSuccessStatusCode, body);
        using var doc = JsonDocument.Parse(body);
        Assert.Equal(jobId, doc.RootElement.GetProperty("jobId").GetGuid());
        var job = await host.SingleJobAsync();
        Assert.Equal(AiJobStatus.Succeeded, job.Status);
    }

    // =====================================================================================================
    // A failure that is not worth sending again keeps its normal 400
    // =====================================================================================================

    [Fact]
    public async Task A_recording_that_is_refused_for_good_answers_400_not_503()
    {
        await using var host = await Host.CreateAsync(sorter: Sorter.Good, transcriber: Stt.TooLong);
        var farmId = await host.CreateFarmAsync("400-1");

        var response = await host.PostAudioAsync(farmId, "refused-key-1");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.NotEqual("ShramSafal.AiVoiceUnavailable", doc.RootElement.GetProperty("error").GetString());
        Assert.Equal(0, host.Sarvam.VoiceCalls);
        Assert.Equal(AiJobStatus.Failed, (await host.SingleJobAsync()).Status);
    }

    [Fact]
    public async Task A_sorting_failure_that_blames_the_input_answers_400_not_503()
    {
        await using var host = await Host.CreateAsync(sorter: Sorter.UserFault, transcriber: Stt.Words);
        var farmId = await host.CreateFarmAsync("400-2");

        var response = await host.PostAudioAsync(farmId, "refused-key-2");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.NotEqual("ShramSafal.AiVoiceUnavailable", doc.RootElement.GetProperty("error").GetString());
        Assert.Equal(0, host.Gemini.VoiceCalls);
    }

    [Fact]
    public async Task A_request_without_audio_or_words_still_answers_its_validation_400()
    {
        await using var host = await Host.CreateAsync(sorter: Sorter.Good, transcriber: Stt.Words);
        var farmId = await host.CreateFarmAsync("400-3");

        var response = await host.Client.PostAsJsonAsync("/shramsafal/ai/voice-parse", new { farmId, idempotencyKey = "empty-key-1" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.NotEqual("ShramSafal.AiVoiceUnavailable", doc.RootElement.GetProperty("error").GetString());
        Assert.Equal(0, host.Transcriber.Calls);
    }

    [Fact]
    public async Task A_caller_who_is_not_a_member_of_the_farm_still_answers_403_not_503()
    {
        await using var host = await Host.CreateAsync(sorter: Sorter.Good, transcriber: Stt.Throws);

        var response = await host.PostAudioAsync(Guid.NewGuid(), "forbidden-key-1");

        Assert.NotEqual(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.True(
            response.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.NotFound or HttpStatusCode.BadRequest,
            $"an unknown farm answered {(int)response.StatusCode}");
        Assert.Equal(0, host.Transcriber.Calls);
    }

    private static async Task AssertUnavailableAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("ShramSafal.AiVoiceUnavailable", doc.RootElement.GetProperty("error").GetString());
        Assert.False(string.IsNullOrWhiteSpace(doc.RootElement.GetProperty("message").GetString()));
    }

    // =====================================================================================================
    // the host and its fakes
    // =====================================================================================================

    private enum Sorter
    {
        Good,
        Transient,
        UserFault,
    }

    private enum Stt
    {
        Words,
        Throws,
        Empty,
        PartFailed,
        TooLong,
        FailsOnceThenWords,
    }

    private sealed class Host(
        WebApplication app,
        HttpClient client,
        string storageDirectory,
        FakeProvider sarvam,
        FakeProvider gemini,
        FakeTranscriber transcriber) : IAsyncDisposable
    {
        public HttpClient Client { get; } = client;

        public FakeProvider Sarvam { get; } = sarvam;

        public FakeProvider Gemini { get; } = gemini;

        public FakeTranscriber Transcriber { get; } = transcriber;

        public static async Task<Host> CreateAsync(Sorter sorter, Stt transcriber)
        {
            var sarvam = new FakeProvider(AiProviderType.Sarvam, takesVoice: true, sorter);
            var gemini = new FakeProvider(AiProviderType.Gemini, takesVoice: false, sorter);
            var stt = new FakeTranscriber(transcriber);

            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
            builder.WebHost.UseTestServer();
            var storageDirectory = Path.Combine(Path.GetTempPath(), "agrisync-voice-unavailable-tests", Guid.NewGuid().ToString("N"));
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = "Host=localhost;Port=5432;Database=test;Username=test;Password=test",
                ["ShramSafal:Storage:DataDirectory"] = storageDirectory,
            });

            builder.Services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, TestAuthHandler>("Test", _ => { });
            builder.Services.AddAuthorization();
            builder.Services.AddBuildingBlocks();
            builder.Services.AddAnalytics(options => options.UseInMemoryDatabase($"voice-unavailable-analytics-{Guid.NewGuid()}"));
            builder.Services.AddShramSafalApi(builder.Configuration);
            builder.Services.RemoveAll<DbContextOptions<ShramSafalDbContext>>();
            builder.Services.RemoveAll<IDbContextOptionsConfiguration<ShramSafalDbContext>>();
            builder.Services.RemoveAll<IEntitlementPolicy>();
            builder.Services.AddScoped<IEntitlementPolicy>(_ => new AllowEntitlementPolicy());

            builder.Services.RemoveAll<IAiProvider>();
            builder.Services.AddSingleton<IAiProvider>(sarvam);
            builder.Services.AddSingleton<IAiProvider>(gemini);
            builder.Services.RemoveAll<ITranscriberProvider>();
            builder.Services.AddSingleton<ITranscriberProvider>(stt);

            var dbRoot = new InMemoryDatabaseRoot();
            var dbName = $"voice-unavailable-{Guid.NewGuid()}";
            builder.Services.AddDbContext<ShramSafalDbContext>(options => options.UseInMemoryDatabase(dbName, dbRoot));
            builder.Services.RemoveAll<AgriSync.BuildingBlocks.Persistence.IAdminDbContextFactory<ShramSafalDbContext>>();
            builder.Services.AddScoped<AgriSync.BuildingBlocks.Persistence.IAdminDbContextFactory<ShramSafalDbContext>>(_ =>
                new SameStoreAdminDbContextFactory(new DbContextOptionsBuilder<ShramSafalDbContext>().UseInMemoryDatabase(dbName, dbRoot).Options));

            var app = builder.Build();
            app.UseAuthentication();
            app.UseAuthorization();
            app.MapShramSafalApi();
            await app.StartAsync();

            // The row every environment now runs: transcriber Sarvam, sorter Sarvam, voice provider Sarvam, one attempt.
            await using (var scope = app.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
                var config = AiProviderConfig.CreateDefault();
                config.UpdateSettings(
                    modifiedByUserId: TestUserId,
                    defaultProvider: AiProviderType.Sarvam,
                    fallbackEnabled: true,
                    isAiProcessingDisabled: false,
                    maxRetries: 1,
                    circuitBreakerThreshold: 50,
                    circuitBreakerResetSeconds: 60,
                    voiceConfidenceThreshold: 0.60m,
                    receiptConfidenceThreshold: 0.50m,
                    voiceProvider: AiProviderType.Sarvam,
                    receiptProvider: AiProviderType.Gemini,
                    pattiProvider: AiProviderType.Gemini);
                config.SetProviderTuple("Sarvam", "codemix", "Sarvam", null);
                db.AiProviderConfigs.Add(config);
                await db.SaveChangesAsync();
            }

            return new Host(app, app.GetTestClient(), storageDirectory, sarvam, gemini, stt);
        }

        public async Task<Guid> CreateFarmAsync(string label)
        {
            var farmId = Guid.NewGuid();
            var response = await Client.PostAsJsonAsync("/sync/push", new
            {
                deviceId = $"device-{label}",
                mutations = new[]
                {
                    new
                    {
                        clientRequestId = $"req-farm-{label}",
                        mutationType = "create_farm",
                        payload = new { farmId, name = $"Farm {label}" },
                    },
                },
            });
            response.EnsureSuccessStatusCode();
            return farmId;
        }

        public async Task<HttpResponseMessage> PostAudioAsync(Guid farmId, string idempotencyKey)
        {
            using var multipart = new MultipartFormDataContent();
            multipart.Add(new StringContent(farmId.ToString()), "farmId");
            multipart.Add(new StringContent(idempotencyKey), "idempotencyKey");
            var audio = new ByteArrayContent(new byte[] { 0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03 });
            audio.Headers.ContentType = new MediaTypeHeaderValue("audio/webm");
            multipart.Add(audio, "audio", "voice.webm");
            return await Client.PostAsync("/shramsafal/ai/voice-parse", multipart);
        }

        public async Task<AiJob> SingleJobAsync()
        {
            await using var scope = app.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
            return await db.AiJobs.AsNoTracking().SingleAsync();
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await app.StopAsync();
            await app.DisposeAsync();
            if (Directory.Exists(storageDirectory))
            {
                Directory.Delete(storageDirectory, recursive: true);
            }
        }
    }

    private sealed class FakeTranscriber(Stt mode) : ITranscriberProvider
    {
        private int _calls;

        public AiProviderType ProviderType => AiProviderType.Sarvam;

        public bool SupportsStreaming => false;

        public int Calls => Volatile.Read(ref _calls);

        public Task<TranscribeResult> TranscribeAsync(Stream audio, string mimeType, string languageHint, string mode2, CancellationToken ct)
        {
            var call = Interlocked.Increment(ref _calls);
            return mode switch
            {
                Stt.Words => Task.FromResult(Heard()),
                Stt.Throws => throw new HttpRequestException("Sarvam is unreachable"),
                Stt.Empty => Task.FromResult(new TranscribeResult { Success = true, Transcript = "  " }),
                Stt.PartFailed => Task.FromResult(new TranscribeResult
                {
                    Success = false,
                    Error = "Sarvam STT failed on part 2 of 3: HTTP 503",
                    FailureCode = TranscribeFailureCodes.PartFailed,
                    Pieces = 3,
                }),
                Stt.TooLong => Task.FromResult(new TranscribeResult
                {
                    Success = false,
                    Error = "Audio is longer than 15 minutes; it was not transcribed.",
                    FailureCode = TranscribeFailureCodes.AudioTooLong,
                }),
                Stt.FailsOnceThenWords => call == 1 ? throw new HttpRequestException("Sarvam is unreachable") : Task.FromResult(Heard()),
                _ => throw new ArgumentOutOfRangeException(nameof(mode)),
            };
        }

        public IAsyncEnumerable<string> TranscribeStreamAsync(Stream audio, string mimeType, string languageHint, string mode2, CancellationToken ct) =>
            throw new NotSupportedException();

        private static TranscribeResult Heard() => new()
        {
            Success = true,
            Transcript = Transcript,
            Pieces = 1,
            ProviderModelVersion = "saaras:v4",
        };
    }

    private sealed class FakeProvider(AiProviderType type, bool takesVoice, Sorter sorter) : IAiProvider
    {
        private readonly ConcurrentQueue<string> _mimes = new();

        public AiProviderType ProviderType => type;

        public int VoiceCalls => _mimes.Count;

        public IReadOnlyCollection<string> Mimes => _mimes.ToArray();

        public string? LastMime => _mimes.LastOrDefault();

        public bool CanHandle(AiOperationType operation) => operation != AiOperationType.VoiceToStructuredLog || takesVoice;

        public Task<bool> HealthCheckAsync(CancellationToken ct = default) => Task.FromResult(true);

        public Task<VoiceParseCanonicalResult> ParseVoiceAsync(
            Stream audioStream,
            string mimeType,
            string languageHint,
            string systemPrompt,
            CancellationToken ct = default)
        {
            _mimes.Enqueue(mimeType);
            return Task.FromResult(sorter switch
            {
                Sorter.Transient => new VoiceParseCanonicalResult { Success = false, Error = "timeout transient failure" },
                Sorter.UserFault => new VoiceParseCanonicalResult { Success = false, Error = "invalid input required field" },
                _ => new VoiceParseCanonicalResult
                {
                    Success = true,
                    OverallConfidence = 0.92m,
                    NormalizedJson = """
                                     {
                                       "summary":"काम नोंदवले गेले.",
                                       "dayOutcome":"WORK_RECORDED",
                                       "cropActivities":[],
                                       "irrigation":[],
                                       "labour":[],
                                       "inputs":[],
                                       "machinery":[],
                                       "activityExpenses":[],
                                       "observations":[],
                                       "plannedTasks":[],
                                       "disturbance":null,
                                       "missingSegments":[],
                                       "unclearSegments":[],
                                       "questionsForUser":[],
                                       "fieldConfidences":{"summary":{"score":0.92,"level":"HIGH","reason":"test"}},
                                       "confidence":0.92,
                                       "fullTranscript":"आज पाणी दिलं."
                                     }
                                     """,
                },
            });
        }

        public Task<ReceiptExtractCanonicalResult> ExtractReceiptAsync(Stream imageStream, string mimeType, string systemPrompt, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<ReceiptExtractCanonicalResult> ExtractPattiAsync(Stream imageStream, string mimeType, string systemPrompt, CancellationToken ct = default) =>
            throw new NotSupportedException();
    }

    private sealed class AllowEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            AgriSync.SharedKernel.Contracts.Ids.UserId userId,
            AgriSync.SharedKernel.Contracts.Ids.FarmId farmId,
            PaidFeature feature,
            CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(Allowed: true, EntitlementReason.Allowed, SubscriptionStatus: null));
    }

    private sealed class TestAuthHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var claims = new[]
            {
                new Claim("sub", TestUserId.ToString()),
                new Claim("membership", "shramsafal:PrimaryOwner"),
            };

            var identity = new ClaimsIdentity(claims, Scheme.Name);
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme.Name)));
        }
    }
}
