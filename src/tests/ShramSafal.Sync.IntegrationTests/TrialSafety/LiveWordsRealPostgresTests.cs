// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (voice live words, founder 28 Nov 2026)
using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Api.Endpoints;
using ShramSafal.Application.Ports.External;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.TrialSafety;

/// <summary>
/// <c>POST /shramsafal/ai/live-words</c> (the words shown while he speaks) over the real pipeline on real Postgres as the app role: the
/// same trial / plan gate as <c>/ai/voice-parse</c> (a refused farm costs no speech-to-text), only one phrase in the one format the
/// recorder writes, and every answer the phone must tell apart (words, busy, off, unavailable). The speech service itself is a fake:
/// no test here reaches Sarvam.
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class LiveWordsRealPostgresTests(TrialSafetyDatabase db) : IClassFixture<TrialSafetyDatabase>
{
    [Fact]
    public async Task A_refused_farm_a_stranger_and_a_missing_farm_cost_no_speech_to_text_and_an_extension_opens_the_door()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var (farm, account, owner) = await SeedExpiredFarmAsync();
        var fake = new FakeLiveWords { Reply = new LiveWordsResult(LiveWordsOutcome.Words, "आज पाच मजूर होते", 700) };
        await using var app = await db.BuildHostAsync(configureServices: s => s.AddScoped<ILiveWordsTranscriber>(_ => fake));
        using var client = app.GetTestClient();

        using (var expired = await PostAsync(client, owner, farm, Wav(3)))
        {
            var text = await expired.Content.ReadAsStringAsync();
            expired.StatusCode.Should().Be(HttpStatusCode.Forbidden, text);
            text.Should().Contain("entitlement.subscriptionexpired");
        }

        using (var stranger = await PostAsync(client, Guid.NewGuid(), farm, Wav(3)))
        {
            stranger.StatusCode.Should().Be(HttpStatusCode.Forbidden, "a non-member is refused by the farm scope");
            (await stranger.Content.ReadAsStringAsync()).Should().NotContain("entitlement.");
        }

        using (var noFarm = await PostAsync(client, owner, farm: null, Wav(3)))
        {
            noFarm.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await noFarm.Content.ReadAsStringAsync()).Should().Contain("farm_id is required");
        }

        fake.Calls.Should().Be(0, "no speech-to-text is bought for a refused request");

        await db.SeedExtensionAsync(account, DateTime.UtcNow.AddMinutes(-1), DateTime.UtcNow.AddDays(10));
        using var ok = await PostAsync(client, owner, farm, Wav(3), seq: 7);
        var body = await ok.Content.ReadAsStringAsync();
        ok.StatusCode.Should().Be(HttpStatusCode.OK, body);
        using var json = JsonDocument.Parse(body);
        json.RootElement.GetProperty("text").GetString().Should().Be("आज पाच मजूर होते");
        json.RootElement.GetProperty("seq").GetInt32().Should().Be(7);
        ok.Headers.GetValues("Server-Timing").Should().ContainSingle().Which.Should().Be("stt;dur=700");
        fake.Calls.Should().Be(1);
        fake.LastWavBytes.Should().Be(Wav(3).Length);
    }

    [Fact]
    public async Task Anything_but_one_short_phrase_in_the_recorders_own_format_is_refused_before_speech_to_text()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var (farm, account, owner) = await SeedExpiredFarmAsync();
        await db.SeedExtensionAsync(account, DateTime.UtcNow.AddMinutes(-1), DateTime.UtcNow.AddDays(10));
        var fake = new FakeLiveWords { Reply = new LiveWordsResult(LiveWordsOutcome.Words, "x", 1) };
        await using var app = await db.BuildHostAsync(configureServices: s => s.AddScoped<ILiveWordsTranscriber>(_ => fake));
        using var client = app.GetTestClient();

        foreach (var (what, audio) in new (string, byte[])[]
        {
            ("not a WAV", Encoding.UTF8.GetBytes(new string('x', 5000))),
            ("longer than 12 s", Wav(13)),
            ("too short", Wav(0.1)),
            ("8 kHz", Wav(2, rate: 8000)),
        })
        {
            using var refused = await PostAsync(client, owner, farm, audio);
            refused.StatusCode.Should().Be(HttpStatusCode.BadRequest, what);
        }

        using (var noAudio = await PostAsync(client, owner, farm, audio: null))
        {
            noAudio.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        fake.Calls.Should().Be(0);
    }

    [Theory]
    [InlineData(LiveWordsOutcome.Quiet, HttpStatusCode.OK, null)]
    [InlineData(LiveWordsOutcome.Busy, HttpStatusCode.TooManyRequests, "ShramSafal.LiveWordsBusy")]
    [InlineData(LiveWordsOutcome.Unavailable, HttpStatusCode.ServiceUnavailable, "ShramSafal.LiveWordsUnavailable")]
    public async Task Each_outcome_has_its_own_answer_the_phone_can_tell_apart(LiveWordsOutcome outcome, HttpStatusCode status, string? code)
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var (farm, account, owner) = await SeedExpiredFarmAsync();
        await db.SeedExtensionAsync(account, DateTime.UtcNow.AddMinutes(-1), DateTime.UtcNow.AddDays(10));
        var fake = new FakeLiveWords { Reply = LiveWordsResult.Of(outcome, 40) };
        await using var app = await db.BuildHostAsync(configureServices: s => s.AddScoped<ILiveWordsTranscriber>(_ => fake));
        using var client = app.GetTestClient();

        using var response = await PostAsync(client, owner, farm, Wav(2));

        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(status, text);
        if (code is null)
        {
            JsonDocument.Parse(text).RootElement.GetProperty("text").GetString().Should().BeEmpty("a quiet phrase is an answer, not an error");
        }
        else
        {
            text.Should().Contain(code);
        }
    }

    [Fact]
    public async Task Switched_off_on_the_server_the_route_says_so_and_nothing_else_runs()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var (farm, _, owner) = await SeedExpiredFarmAsync(); // an expired farm: the "off" answer comes before the gate, so no farm is read
        var fake = new FakeLiveWords { IsEnabled = false };
        await using var app = await db.BuildHostAsync(configureServices: s => s.AddScoped<ILiveWordsTranscriber>(_ => fake));
        using var client = app.GetTestClient();

        using var response = await PostAsync(client, owner, farm, Wav(2));

        response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        (await response.Content.ReadAsStringAsync()).Should().Contain("ShramSafal.LiveWordsOff");
        fake.Calls.Should().Be(0);
    }

    [Fact]
    public async Task Nobody_signed_in_is_refused()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        await using var app = await db.BuildHostAsync(configureServices: s => s.AddScoped<ILiveWordsTranscriber>(_ => new FakeLiveWords()));
        using var client = app.GetTestClient();

        using var request = new HttpRequestMessage(HttpMethod.Post, "/shramsafal/ai/live-words") { Content = new MultipartFormDataContent() };
        using var response = await client.SendAsync(request);

        response.StatusCode.Should().BeOneOf(HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden);
    }

    // ── helpers ──

    private async Task<(Guid Farm, Guid Account, Guid Owner)> SeedExpiredFarmAsync()
    {
        var farm = Guid.NewGuid();
        var account = Guid.NewGuid();
        var owner = Guid.NewGuid();
        await db.SeedAccountAsync(account, owner, farm);
        await db.SeedFarmAsync(farm, owner, account, ShramSafal.Domain.Farms.FarmCode.New());
        await db.SeedSubscriptionAsync(account, 4, DateTime.UtcNow.AddDays(-2));
        return (farm, account, owner);
    }

    private static Task<HttpResponseMessage> PostAsync(HttpClient client, Guid who, Guid? farm, byte[]? audio, int seq = 1)
    {
        var form = new MultipartFormDataContent { { new StringContent("mr-IN"), "language_hint" }, { new StringContent(seq.ToString()), "seq" } };
        if (farm is { } id)
        {
            form.Add(new StringContent(id.ToString()), "farm_id");
        }

        if (audio is not null)
        {
            var file = new ByteArrayContent(audio);
            file.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("audio/wav");
            form.Add(file, "audio", "phrase.wav");
        }

        return TrialSafetyDatabase.SendAsync(client, HttpMethod.Post, "/shramsafal/ai/live-words", who, content: form);
    }

    private static byte[] Wav(double seconds, int rate = 16000)
    {
        var data = (int)(seconds * 16000 * 2);
        var bytes = new byte[44 + data];
        Encoding.ASCII.GetBytes("RIFF").CopyTo(bytes, 0);
        BitConverter.GetBytes(36 + data).CopyTo(bytes, 4);
        Encoding.ASCII.GetBytes("WAVEfmt ").CopyTo(bytes, 8);
        BitConverter.GetBytes(16).CopyTo(bytes, 16);
        BitConverter.GetBytes((short)1).CopyTo(bytes, 20);
        BitConverter.GetBytes((short)1).CopyTo(bytes, 22);
        BitConverter.GetBytes(rate).CopyTo(bytes, 24);
        BitConverter.GetBytes(rate * 2).CopyTo(bytes, 28);
        BitConverter.GetBytes((short)2).CopyTo(bytes, 32);
        BitConverter.GetBytes((short)16).CopyTo(bytes, 34);
        Encoding.ASCII.GetBytes("data").CopyTo(bytes, 36);
        BitConverter.GetBytes(data).CopyTo(bytes, 40);
        return bytes;
    }

    private sealed class FakeLiveWords : ILiveWordsTranscriber
    {
        public bool IsEnabled { get; init; } = true;
        public LiveWordsResult Reply { get; init; } = LiveWordsResult.Of(LiveWordsOutcome.Quiet);
        public int Calls;
        public int LastWavBytes;

        public bool Enabled => IsEnabled;

        public Task<LiveWordsResult> TranscribeAsync(byte[] wav, string? languageHint, CancellationToken ct)
        {
            Interlocked.Increment(ref Calls);
            LastWavBytes = wav.Length;
            return Task.FromResult(Reply);
        }
    }
}

/// <summary>The phone's timing line for its previous recording, made safe to write into the server's log.</summary>
public sealed class ClientTimingSanitizeTests
{
    [Fact]
    public void A_normal_line_goes_through_unchanged()
    {
        const string line = "stopToAck=410,stopToUpload=520,upload=900,server=5200,s3=300,stt=2400,struct=2500,stopToResult=7100,recording=31400,net=4g,mem=mid";

        AiEndpoints.SanitizeClientTiming(line).Should().Be(line);
    }

    [Fact]
    public void A_line_break_or_free_text_cannot_get_into_the_log()
    {
        const string forged = "a=1\r\n[ERROR] forged line <script> उदाहरण";

        var safe = AiEndpoints.SanitizeClientTiming(forged)!;

        safe.Should().StartWith("a=1").And.HaveLength(forged.Length);
        safe.Should().NotContainAny("\r", "\n", "[", "]", "<", ">", " ", "उ");
        safe.Should().Contain("ERROR").And.Contain("script");
    }

    [Fact]
    public void Blank_is_nothing_and_long_is_cut()
    {
        AiEndpoints.SanitizeClientTiming(null).Should().BeNull();
        AiEndpoints.SanitizeClientTiming("   ").Should().BeNull();
        AiEndpoints.SanitizeClientTiming(new string('a', 1000))!.Length.Should().Be(240);
    }
}
