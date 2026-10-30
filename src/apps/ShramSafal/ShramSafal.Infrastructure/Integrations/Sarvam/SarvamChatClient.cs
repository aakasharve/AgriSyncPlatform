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
            // PLR lane V-1 — the structurer writes a long recording's answer within its own, longer, timeout.
            using var timeout = CreateTimeoutToken(ct, _options.ChatTimeoutSeconds);
            var client = httpClientFactory.CreateClient("SarvamAiProvider");

            using var request = new HttpRequestMessage(HttpMethod.Post, _options.ChatEndpoint)
            {
                Content = JsonContent.Create(BuildRequestBody(systemPrompt, userMessage))
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

            // PLR V-1 (lane AI-1) — the answer was CUT OFF at the model's output-token limit (Sarvam's default
            // max_tokens is 2048; lane V-1 now sends ChatMaxTokens). Cut-off JSON does not parse, and the normalizer turns
            // an unparseable answer into an EMPTY "successful" parse: the farmer's words silently become nothing.
            // A cut-off answer is a failure, said out loud, so the orchestrator's fallback or the error path runs.
            // PLR lane V-1 fix pass 2 — what the API says about every answer, as it says it: the live 10-minute run
            // was cut off at 3721 completion tokens with max_tokens 4096, so the usage object (prompt / completion /
            // total and any token details) and any reasoning text beside the answer are logged as returned.
            var usage = TryExtractUsage(body);
            var reasoningChars = TryExtractReasoningChars(body);
            if (WasCutOff(body))
            {
                logger.LogWarning(
                    "Sarvam chat answer was cut off at the token limit (finish_reason=length). max_tokens={MaxTokens}; usage as returned: {Usage}; reasoning text: {ReasoningChars} chars.",
                    _options.ChatMaxTokens,
                    usage ?? "(none)",
                    reasoningChars?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "none");
                return SarvamChatResult.CutOff(CutOffError, usage, TryExtractContent(body), reasoningChars);
            }

            var content = TryExtractContent(body);
            if (string.IsNullOrWhiteSpace(content))
            {
                return SarvamChatResult.Failure("Sarvam chat response did not contain content.");
            }

            return new SarvamChatResult(true, content, null, TryExtractCompletionTokens(body), usage, null, reasoningChars);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Sarvam chat call failed.");
            return SarvamChatResult.Failure(ex.Message);
        }
    }

    /// <summary>
    /// The chat request body. PLR lane V-1: an explicit <c>max_tokens</c> (<see cref="SarvamOptions.ChatMaxTokens"/>)
    /// replaces Sarvam's silent 2048 default; 0 or less sends none.
    /// </summary>
    internal Dictionary<string, object> BuildRequestBody(string systemPrompt, string userMessage)
    {
        var body = new Dictionary<string, object>
        {
            ["model"] = _options.ChatModel,
            ["messages"] = new object[]
            {
                new { role = "system", content = systemPrompt },
                new { role = "user", content = userMessage },
            },
            ["temperature"] = _options.ChatTemperature,
        };
        if (_options.ChatMaxTokens > 0)
        {
            body["max_tokens"] = _options.ChatMaxTokens;
        }

        return body;
    }

    internal const string CutOffError =
        "Sarvam chat answer was cut off at the model's token limit (finish_reason=length); the parse is incomplete.";

    private static bool WasCutOff(string responseBody)
    {
        try
        {
            using var document = JsonDocument.Parse(responseBody);
            if (!document.RootElement.TryGetProperty("choices", out var choices) ||
                choices.ValueKind != JsonValueKind.Array)
            {
                return false;
            }

            foreach (var choice in choices.EnumerateArray())
            {
                if (choice.ValueKind == JsonValueKind.Object &&
                    choice.TryGetProperty("finish_reason", out var reason) &&
                    reason.ValueKind == JsonValueKind.String &&
                    string.Equals(reason.GetString(), "length", StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
        }
        catch (JsonException)
        {
            return false;
        }

        return false;
    }

    /// <summary>The <c>usage</c> object exactly as the API returned it (token counts only — no words), or null.</summary>
    private static string? TryExtractUsage(string responseBody)
    {
        try
        {
            using var document = JsonDocument.Parse(responseBody);
            return document.RootElement.ValueKind == JsonValueKind.Object &&
                   document.RootElement.TryGetProperty("usage", out var usage) &&
                   usage.ValueKind == JsonValueKind.Object
                ? usage.GetRawText()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>The length of any reasoning text the model returned beside its answer (a reasoning model's
    /// <c>reasoning_content</c> counts against max_tokens without being part of the answer).</summary>
    private static int? TryExtractReasoningChars(string responseBody)
    {
        try
        {
            using var document = JsonDocument.Parse(responseBody);
            if (!document.RootElement.TryGetProperty("choices", out var choices) || choices.ValueKind != JsonValueKind.Array)
            {
                return null;
            }

            foreach (var choice in choices.EnumerateArray())
            {
                if (choice.ValueKind == JsonValueKind.Object &&
                    choice.TryGetProperty("message", out var message) &&
                    message.ValueKind == JsonValueKind.Object &&
                    message.TryGetProperty("reasoning_content", out var reasoning) &&
                    reasoning.ValueKind == JsonValueKind.String)
                {
                    return reasoning.GetString()?.Length ?? 0;
                }
            }

            return null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static int? TryExtractCompletionTokens(string responseBody)
    {
        try
        {
            using var document = JsonDocument.Parse(responseBody);
            return document.RootElement.TryGetProperty("usage", out var usage) &&
                   usage.ValueKind == JsonValueKind.Object &&
                   usage.TryGetProperty("completion_tokens", out var tokens) &&
                   tokens.ValueKind == JsonValueKind.Number &&
                   tokens.TryGetInt32(out var value)
                ? value
                : null;
        }
        catch (JsonException)
        {
            return null;
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

// SarvamChatResult moved to SarvamApiDtos.cs (Task 2.9 ACL — Safeguard S3).
