using System.Net;
using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using ShramSafal.Infrastructure.AI;
using ShramSafal.Infrastructure.Integrations.Gemini;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

public sealed class GeminiAdapterTests
{
    [Fact]
    public void JsonCleaner_RemovesMarkdownCodeFence()
    {
        var input = """
                    ```json
                    {summary: "ok", confidence: 0.9}
                    ```
                    """;

        var cleaned = GeminiJsonCleaner.Clean(input);

        Assert.DoesNotContain("```", cleaned, StringComparison.Ordinal);
        Assert.Contains("\"summary\"", cleaned, StringComparison.Ordinal);
    }

    [Fact]
    public void JsonCleaner_RemovesTrailingCommas()
    {
        var input = """
                    {
                      "summary": "ok",
                      "items": [1,2,],
                    }
                    """;

        var cleaned = GeminiJsonCleaner.Clean(input);

        Assert.DoesNotContain(",}", cleaned, StringComparison.Ordinal);
        Assert.DoesNotContain(",]", cleaned, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ParseVoice_ExtractsAndNormalizesResponseContent()
    {
        var responsePayload = """
                              {
                                "candidates": [
                                  {
                                    "content": {
                                      "parts": [
                                        {
                                          "text": "```json\n{\"summary\":\"ok\",\"dayOutcome\":\"WORK_RECORDED\",\"cropActivities\":[],\"irrigation\":[],\"labour\":[],\"inputs\":[],\"machinery\":[],\"activityExpenses\":[],\"observations\":[],\"plannedTasks\":[],\"missingSegments\":[],\"unclearSegments\":[],\"questionsForUser\":[],\"fieldConfidences\":{},\"confidence\":0.87,\"fullTranscript\":\"आज पाणी दिलं.\"}\n```"
                                        }
                                      ]
                                    }
                                  }
                                ]
                              }
                              """;

        var provider = CreateProvider(responsePayload);
        await using var stream = new MemoryStream(Encoding.UTF8.GetBytes("आज पाणी दिलं."));

        var result = await provider.ParseVoiceAsync(
            stream,
            "text/plain",
            "mr-IN",
            "system-prompt",
            CancellationToken.None);

        Assert.True(result.Success);
        Assert.NotNull(result.NormalizedJson);
        Assert.Contains("\"summary\":\"ok\"", result.NormalizedJson, StringComparison.Ordinal);
        Assert.Equal("आज पाणी दिलं.", result.RawTranscript?.Trim());
        Assert.True(result.OverallConfidence > 0m);
    }

    private static GeminiAiProvider CreateProvider(string responsePayload)
    {
        var options = Options.Create(new GeminiOptions
        {
            ApiKey = "test-key",
            BaseUrl = "https://unit.test",
            ModelId = "gemini-2.0-flash",
            TimeoutSeconds = 5
        });

        var handler = new StubHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(responsePayload, Encoding.UTF8, "application/json")
        });

        var client = new HttpClient(handler)
        {
            BaseAddress = new Uri("https://unit.test")
        };

        var factory = new StaticHttpClientFactory(client);
        return new GeminiAiProvider(
            options,
            factory,
            new AiResponseNormalizer(),
            NullLogger<GeminiAiProvider>.Instance);
    }
}

internal sealed class StaticHttpClientFactory(HttpClient client) : IHttpClientFactory
{
    public HttpClient CreateClient(string name) => client;
}

internal sealed class StubHttpMessageHandler(
    Func<HttpRequestMessage, HttpResponseMessage> responder) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        return Task.FromResult(responder(request));
    }
}
