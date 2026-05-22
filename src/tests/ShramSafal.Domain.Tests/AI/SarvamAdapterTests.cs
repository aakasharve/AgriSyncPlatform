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
    public async Task StreamingSttClient_RejectsUnsupportedWebmMime()
    {
        var options = Options.Create(CreateOptions());
        var client = new SarvamStreamingSttClient(
            options,
            NullLogger<SarvamStreamingSttClient>.Instance);

        await using var stream = new MemoryStream([0x10, 0x20]);
        var result = await client.TranscribeAsync(stream, "audio/webm", CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Null(result.Transcript);
        Assert.Contains("WAV or raw PCM", result.Error, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("webm", result.Error, StringComparison.OrdinalIgnoreCase);
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
