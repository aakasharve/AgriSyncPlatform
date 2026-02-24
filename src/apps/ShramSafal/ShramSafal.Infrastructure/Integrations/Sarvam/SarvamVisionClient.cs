using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace ShramSafal.Infrastructure.Integrations.Sarvam;

internal sealed class SarvamVisionClient(
    IOptions<SarvamOptions> optionsAccessor,
    IHttpClientFactory httpClientFactory,
    ILogger<SarvamVisionClient> logger)
{
    private readonly SarvamOptions _options = optionsAccessor.Value;

    public async Task<SarvamVisionResult> ExtractTextAsync(
        Stream imageStream,
        string mimeType,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_options.ApiSubscriptionKey))
        {
            return SarvamVisionResult.Failure("Sarvam API subscription key is not configured.");
        }

        try
        {
            var base64Image = await ReadAsBase64Async(imageStream, ct);
            using var timeout = CreateTimeoutToken(ct, _options.DocIntelTimeoutSeconds);
            var client = httpClientFactory.CreateClient("SarvamAiProvider");

            var requestBody = new
            {
                model = _options.VisionModel,
                messages = new object[]
                {
                    new
                    {
                        role = "system",
                        content = "You are an OCR assistant. Extract all visible text exactly as plain text."
                    },
                    new
                    {
                        role = "user",
                        content = new object[]
                        {
                            new
                            {
                                type = "text",
                                text = "Extract all text from this image while preserving important numbers and units."
                            },
                            new
                            {
                                type = "image_url",
                                image_url = new
                                {
                                    url = $"data:{NormalizeMimeType(mimeType)};base64,{base64Image}"
                                }
                            }
                        }
                    }
                },
                temperature = 0.0m
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
                                    $"Sarvam vision call failed with status {(int)response.StatusCode}.";
                return SarvamVisionResult.Failure(providerError);
            }

            var extractedText = TryExtractContent(body);
            if (string.IsNullOrWhiteSpace(extractedText))
            {
                return SarvamVisionResult.Failure("Sarvam vision response did not contain extracted text.");
            }

            return SarvamVisionResult.Success(extractedText);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Sarvam vision call failed.");
            return SarvamVisionResult.Failure(ex.Message);
        }
    }

    private static string NormalizeMimeType(string mimeType)
    {
        return string.IsNullOrWhiteSpace(mimeType) ? "image/jpeg" : mimeType.Trim();
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
        var timeout = timeoutSeconds <= 0 ? 120 : timeoutSeconds;
        var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);
        linked.CancelAfter(TimeSpan.FromSeconds(timeout));
        return linked;
    }

    private static async Task<string> ReadAsBase64Async(Stream stream, CancellationToken ct)
    {
        if (stream.CanSeek)
        {
            stream.Position = 0;
        }

        await using var memory = new MemoryStream();
        await stream.CopyToAsync(memory, ct);
        return Convert.ToBase64String(memory.ToArray());
    }
}

internal sealed record SarvamVisionResult(bool IsSuccess, string? ExtractedText, string? Error)
{
    public static SarvamVisionResult Success(string extractedText) =>
        new(true, extractedText, null);

    public static SarvamVisionResult Failure(string error) =>
        new(false, null, error);
}
