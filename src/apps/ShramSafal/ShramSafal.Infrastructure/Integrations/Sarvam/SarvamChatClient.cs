using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace ShramSafal.Infrastructure.Integrations.Sarvam;

internal sealed class SarvamChatClient(
    IOptions<SarvamOptions> optionsAccessor,
    IHttpClientFactory httpClientFactory,
    ILogger<SarvamChatClient> logger)
{
    private readonly SarvamOptions _options = optionsAccessor.Value;

    public async Task<SarvamChatResult> CompleteAsync(
        string systemPrompt,
        string userMessage,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_options.ApiSubscriptionKey))
        {
            return SarvamChatResult.Failure("Sarvam API subscription key is not configured.");
        }

        try
        {
            using var timeout = CreateTimeoutToken(ct, _options.TimeoutSeconds);
            var client = httpClientFactory.CreateClient("SarvamAiProvider");

            var requestBody = new
            {
                model = _options.ChatModel,
                messages = new object[]
                {
                    new
                    {
                        role = "system",
                        content = systemPrompt
                    },
                    new
                    {
                        role = "user",
                        content = userMessage
                    }
                },
                temperature = _options.ChatTemperature
            };

            using var request = new HttpRequestMessage(HttpMethod.Post, _options.ChatEndpoint)
            {
                Content = JsonContent.Create(requestBody)
            };
            request.Headers.TryAddWithoutValidation("api-subscription-key", _options.ApiSubscriptionKey);

            using var response = await client.SendAsync(request, timeout.Token);
            var body = await response.Content.ReadAsStringAsync(timeout.Token);
            if (!response.IsSuccessStatusCode)
            {
                var providerError = TryExtractProviderError(body) ??
                                    $"Sarvam chat call failed with status {(int)response.StatusCode}.";
                return SarvamChatResult.Failure(providerError);
            }

            var content = TryExtractContent(body);
            if (string.IsNullOrWhiteSpace(content))
            {
                return SarvamChatResult.Failure("Sarvam chat response did not contain content.");
            }

            return SarvamChatResult.Success(content);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Sarvam chat call failed.");
            return SarvamChatResult.Failure(ex.Message);
        }
    }

    private static string? TryExtractContent(string responseBody)
    {
        try
        {
            using var document = JsonDocument.Parse(responseBody);
            if (!document.RootElement.TryGetProperty("choices", out var choices) ||
                choices.ValueKind != JsonValueKind.Array)
            {
                return null;
            }

            foreach (var choice in choices.EnumerateArray())
            {
                if (!choice.TryGetProperty("message", out var message) || message.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                if (!message.TryGetProperty("content", out var contentNode))
                {
                    continue;
                }

                if (contentNode.ValueKind == JsonValueKind.String)
                {
                    return contentNode.GetString();
                }

                if (contentNode.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in contentNode.EnumerateArray())
                    {
                        if (item.ValueKind == JsonValueKind.String)
                        {
                            return item.GetString();
                        }

                        if (item.ValueKind == JsonValueKind.Object &&
                            item.TryGetProperty("text", out var textNode) &&
                            textNode.ValueKind == JsonValueKind.String)
                        {
                            return textNode.GetString();
                        }
                    }
                }
            }
        }
        catch (JsonException)
        {
            return null;
        }

        return null;
    }

    private static string? TryExtractProviderError(string responseBody)
    {
        try
        {
            using var document = JsonDocument.Parse(responseBody);
            var root = document.RootElement;
            if (root.TryGetProperty("error", out var errorNode))
            {
                if (errorNode.ValueKind == JsonValueKind.String)
                {
                    return errorNode.GetString();
                }

                if (errorNode.ValueKind == JsonValueKind.Object &&
                    errorNode.TryGetProperty("message", out var messageNode) &&
                    messageNode.ValueKind == JsonValueKind.String)
                {
                    return messageNode.GetString();
                }
            }

            if (root.TryGetProperty("message", out var rootMessage) &&
                rootMessage.ValueKind == JsonValueKind.String)
            {
                return rootMessage.GetString();
            }
        }
        catch (JsonException)
        {
            return null;
        }

        return null;
    }

    private static CancellationTokenSource CreateTimeoutToken(CancellationToken ct, int timeoutSeconds)
    {
        var timeout = timeoutSeconds <= 0 ? 45 : timeoutSeconds;
        var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);
        linked.CancelAfter(TimeSpan.FromSeconds(timeout));
        return linked;
    }
}

internal sealed record SarvamChatResult(bool IsSuccess, string? Content, string? Error)
{
    public static SarvamChatResult Success(string content) =>
        new(true, content, null);

    public static SarvamChatResult Failure(string error) =>
        new(false, null, error);
}
