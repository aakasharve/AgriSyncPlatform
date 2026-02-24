using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.AI;
using ShramSafal.Infrastructure.AI;

namespace ShramSafal.Infrastructure.Integrations.Gemini;

internal sealed class GeminiAiProvider(
    IOptions<GeminiOptions> optionsAccessor,
    IHttpClientFactory httpClientFactory,
    AiResponseNormalizer responseNormalizer,
    ILogger<GeminiAiProvider> logger) : IAiProvider
{
    private readonly GeminiOptions _options = optionsAccessor.Value;

    public AiProviderType ProviderType => AiProviderType.Gemini;

    public bool CanHandle(AiOperationType operation)
    {
        return operation is AiOperationType.VoiceToStructuredLog
            or AiOperationType.ReceiptToExpenseItems
            or AiOperationType.PattiImageToSaleData;
    }

    public async Task<bool> HealthCheckAsync(CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_options.ApiKey))
        {
            return false;
        }

        try
        {
            using var timeout = CreateTimeoutToken(ct);
            var client = httpClientFactory.CreateClient("GeminiAiProvider");

            var requestBody = new
            {
                contents = new[]
                {
                    new
                    {
                        role = "user",
                        parts = new[] { new { text = "ping" } }
                    }
                },
                generationConfig = new
                {
                    responseMimeType = "text/plain",
                    temperature = 0.0m,
                    maxOutputTokens = 8
                }
            };

            using var request = new HttpRequestMessage(HttpMethod.Post, BuildGenerateContentUrl())
            {
                Content = JsonContent.Create(requestBody)
            };

            using var response = await client.SendAsync(request, timeout.Token);
            return response.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Gemini health check failed.");
            return false;
        }
    }

    public async Task<VoiceParseCanonicalResult> ParseVoiceAsync(
        Stream audioStream,
        string mimeType,
        string languageHint,
        string systemPrompt,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_options.ApiKey))
        {
            return new VoiceParseCanonicalResult
            {
                Success = false,
                Error = "Gemini API key is not configured."
            };
        }

        try
        {
            var userParts = new List<object>();
            string? rawTranscript = null;

            if (mimeType.StartsWith("text/", StringComparison.OrdinalIgnoreCase))
            {
                using var reader = new StreamReader(audioStream, leaveOpen: true);
                rawTranscript = await reader.ReadToEndAsync(ct);
                userParts.Add(new { text = rawTranscript });
            }
            else
            {
                var base64 = await ReadAsBase64Async(audioStream, ct);
                userParts.Add(new
                {
                    inlineData = new
                    {
                        mimeType = string.IsNullOrWhiteSpace(mimeType) ? "audio/webm" : mimeType,
                        data = base64
                    }
                });
                if (!string.IsNullOrWhiteSpace(languageHint))
                {
                    userParts.Add(new { text = $"Language hint: {languageHint}" });
                }
            }

            var generated = await GenerateContentAsync(systemPrompt, userParts, ct);
            if (!generated.Success)
            {
                return new VoiceParseCanonicalResult
                {
                    Success = false,
                    Error = generated.Error
                };
            }

            var cleaned = GeminiJsonCleaner.Clean(generated.Content!);
            var normalized = responseNormalizer.NormalizeVoiceJson(cleaned);
            var confidence = TryExtractConfidence(normalized) ?? 0.75m;
            rawTranscript ??= TryExtractString(normalized, "fullTranscript");

            return new VoiceParseCanonicalResult
            {
                Success = true,
                NormalizedJson = normalized,
                RawTranscript = rawTranscript,
                OverallConfidence = confidence
            };
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Gemini ParseVoiceAsync failed.");
            return new VoiceParseCanonicalResult
            {
                Success = false,
                Error = ex.Message
            };
        }
    }

    public async Task<ReceiptExtractCanonicalResult> ExtractReceiptAsync(
        Stream imageStream,
        string mimeType,
        string systemPrompt,
        CancellationToken ct = default)
    {
        return await ExtractImageAsync(imageStream, mimeType, systemPrompt, ct);
    }

    public async Task<ReceiptExtractCanonicalResult> ExtractPattiAsync(
        Stream imageStream,
        string mimeType,
        string systemPrompt,
        CancellationToken ct = default)
    {
        return await ExtractImageAsync(imageStream, mimeType, systemPrompt, ct);
    }

    private async Task<ReceiptExtractCanonicalResult> ExtractImageAsync(
        Stream imageStream,
        string mimeType,
        string systemPrompt,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(_options.ApiKey))
        {
            return new ReceiptExtractCanonicalResult
            {
                Success = false,
                Error = "Gemini API key is not configured."
            };
        }

        try
        {
            var base64 = await ReadAsBase64Async(imageStream, ct);
            var userParts = new List<object>
            {
                new
                {
                    inlineData = new
                    {
                        mimeType = string.IsNullOrWhiteSpace(mimeType) ? "image/jpeg" : mimeType,
                        data = base64
                    }
                }
            };

            var generated = await GenerateContentAsync(systemPrompt, userParts, ct);
            if (!generated.Success)
            {
                return new ReceiptExtractCanonicalResult
                {
                    Success = false,
                    Error = generated.Error
                };
            }

            var cleaned = GeminiJsonCleaner.Clean(generated.Content!);
            var normalized = responseNormalizer.NormalizeGenericJson(cleaned);

            return new ReceiptExtractCanonicalResult
            {
                Success = true,
                NormalizedJson = normalized,
                OverallConfidence = TryExtractConfidence(normalized) ?? 0.70m
            };
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Gemini image extraction failed.");
            return new ReceiptExtractCanonicalResult
            {
                Success = false,
                Error = ex.Message
            };
        }
    }

    private async Task<(bool Success, string? Content, string? Error)> GenerateContentAsync(
        string systemPrompt,
        List<object> userParts,
        CancellationToken ct)
    {
        using var timeout = CreateTimeoutToken(ct);
        var client = httpClientFactory.CreateClient("GeminiAiProvider");

        var requestBody = new
        {
            systemInstruction = new
            {
                parts = new[] { new { text = systemPrompt } }
            },
            contents = new[]
            {
                new
                {
                    role = "user",
                    parts = userParts
                }
            },
            generationConfig = new
            {
                responseMimeType = "application/json",
                temperature = _options.Temperature,
                maxOutputTokens = _options.MaxTokens
            }
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, BuildGenerateContentUrl())
        {
            Content = JsonContent.Create(requestBody)
        };

        using var response = await client.SendAsync(request, timeout.Token);
        var body = await response.Content.ReadAsStringAsync(timeout.Token);

        if (!response.IsSuccessStatusCode)
        {
            var message = TryExtractProviderError(body) ??
                          $"Gemini call failed with status {(int)response.StatusCode}.";
            return (false, null, message);
        }

        var generatedText = ExtractGeneratedText(body);
        if (string.IsNullOrWhiteSpace(generatedText))
        {
            return (false, null, "Gemini did not return parseable content.");
        }

        return (true, generatedText, null);
    }

    private string BuildGenerateContentUrl()
    {
        var model = string.IsNullOrWhiteSpace(_options.ModelId) ? "gemini-2.0-flash" : _options.ModelId.Trim();
        var baseUrl = string.IsNullOrWhiteSpace(_options.BaseUrl)
            ? "https://generativelanguage.googleapis.com/v1beta"
            : _options.BaseUrl.Trim().TrimEnd('/');

        return $"{baseUrl}/models/{Uri.EscapeDataString(model)}:generateContent?key={Uri.EscapeDataString(_options.ApiKey)}";
    }

    private CancellationTokenSource CreateTimeoutToken(CancellationToken ct)
    {
        var timeoutSeconds = _options.TimeoutSeconds <= 0 ? 30 : _options.TimeoutSeconds;
        var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);
        linked.CancelAfter(TimeSpan.FromSeconds(timeoutSeconds));
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

    private static string? ExtractGeneratedText(string responseBody)
    {
        try
        {
            using var document = JsonDocument.Parse(responseBody);

            if (!document.RootElement.TryGetProperty("candidates", out var candidates) ||
                candidates.ValueKind != JsonValueKind.Array)
            {
                return null;
            }

            foreach (var candidate in candidates.EnumerateArray())
            {
                if (!candidate.TryGetProperty("content", out var content) ||
                    content.ValueKind != JsonValueKind.Object ||
                    !content.TryGetProperty("parts", out var parts) ||
                    parts.ValueKind != JsonValueKind.Array)
                {
                    continue;
                }

                foreach (var part in parts.EnumerateArray())
                {
                    if (part.ValueKind == JsonValueKind.Object &&
                        part.TryGetProperty("text", out var textNode) &&
                        textNode.ValueKind == JsonValueKind.String)
                    {
                        return textNode.GetString();
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
            if (!document.RootElement.TryGetProperty("error", out var errorNode) ||
                errorNode.ValueKind != JsonValueKind.Object)
            {
                return null;
            }

            if (errorNode.TryGetProperty("message", out var messageNode) &&
                messageNode.ValueKind == JsonValueKind.String)
            {
                return messageNode.GetString();
            }
        }
        catch (JsonException)
        {
            return null;
        }

        return null;
    }

    private static decimal? TryExtractConfidence(string normalizedJson)
    {
        try
        {
            using var document = JsonDocument.Parse(normalizedJson);
            if (!document.RootElement.TryGetProperty("confidence", out var confidence))
            {
                return null;
            }

            if (confidence.ValueKind == JsonValueKind.Number && confidence.TryGetDecimal(out var number))
            {
                return Math.Clamp(number, 0m, 1m);
            }

            if (confidence.ValueKind == JsonValueKind.String &&
                decimal.TryParse(confidence.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed))
            {
                return Math.Clamp(parsed, 0m, 1m);
            }
        }
        catch (JsonException)
        {
            return null;
        }

        return null;
    }

    private static string? TryExtractString(string normalizedJson, string propertyName)
    {
        try
        {
            using var document = JsonDocument.Parse(normalizedJson);
            if (document.RootElement.TryGetProperty(propertyName, out var node) &&
                node.ValueKind == JsonValueKind.String)
            {
                return node.GetString();
            }
        }
        catch (JsonException)
        {
            return null;
        }

        return null;
    }
}
