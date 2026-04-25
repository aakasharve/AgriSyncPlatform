using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
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
            var promptVersion = AiPromptLineage.ResolvePromptVersion(systemPrompt);
            var normalized = responseNormalizer.NormalizeVoiceJson(cleaned, promptVersion: promptVersion);
            var confidence = TryExtractConfidence(normalized) ?? 0.75m;
            rawTranscript ??= TryExtractString(normalized, "fullTranscript");

            return new VoiceParseCanonicalResult
            {
                Success = true,
                ModelUsed = ResolveModelId(),
                PromptVersion = promptVersion,
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
        return await ExtractImageAsync(
            imageStream,
            mimeType,
            systemPrompt,
            BuildReceiptResponseSchema(),
            LooksMeaningfulReceiptResult,
            ct);
    }

    public async Task<ReceiptExtractCanonicalResult> ExtractPattiAsync(
        Stream imageStream,
        string mimeType,
        string systemPrompt,
        CancellationToken ct = default)
    {
        return await ExtractImageAsync(
            imageStream,
            mimeType,
            systemPrompt,
            BuildPattiResponseSchema(),
            LooksMeaningfulPattiResult,
            ct);
    }

    private async Task<ReceiptExtractCanonicalResult> ExtractImageAsync(
        Stream imageStream,
        string mimeType,
        string systemPrompt,
        JsonElement responseJsonSchema,
        Func<string, bool> hasMeaningfulResult,
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

            var generated = await GenerateContentAsync(
                systemPrompt,
                userParts,
                ct,
                responseJsonSchema,
                thinkingBudget: 0);
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
            if (!hasMeaningfulResult(normalized))
            {
                return new ReceiptExtractCanonicalResult
                {
                    Success = false,
                    Error = "Gemini returned an empty structured extraction."
                };
            }

            return new ReceiptExtractCanonicalResult
            {
                Success = true,
                ModelUsed = ResolveModelId(),
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
        CancellationToken ct,
        JsonElement? responseJsonSchema = null,
        int? thinkingBudget = null)
    {
        using var timeout = CreateTimeoutToken(ct);
        var client = httpClientFactory.CreateClient("GeminiAiProvider");

        var generationConfig = new JsonObject
        {
            ["responseMimeType"] = "application/json",
            ["temperature"] = JsonValue.Create(_options.Temperature),
            ["maxOutputTokens"] = _options.MaxTokens
        };

        if (responseJsonSchema.HasValue)
        {
            generationConfig["responseJsonSchema"] = JsonNode.Parse(responseJsonSchema.Value.GetRawText());
        }

        if (thinkingBudget.HasValue)
        {
            generationConfig["thinkingConfig"] = new JsonObject
            {
                ["thinkingBudget"] = thinkingBudget.Value
            };
        }

        var requestBody = new JsonObject
        {
            ["systemInstruction"] = JsonSerializer.SerializeToNode(new
            {
                parts = new[] { new { text = systemPrompt } }
            }),
            ["contents"] = JsonSerializer.SerializeToNode(new[]
            {
                new
                {
                    role = "user",
                    parts = userParts
                }
            }),
            ["generationConfig"] = generationConfig
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

        var generation = ExtractGenerationResult(body);
        if (string.Equals(generation.FinishReason, "MAX_TOKENS", StringComparison.OrdinalIgnoreCase))
        {
            return (false, null, "Gemini output was truncated at the max token limit.");
        }

        var generatedText = generation.Text;
        if (string.IsNullOrWhiteSpace(generatedText))
        {
            return (false, null, "Gemini did not return parseable content.");
        }

        return (true, generatedText, null);
    }

    private string BuildGenerateContentUrl()
    {
        var model = ResolveModelId();
        var baseUrl = string.IsNullOrWhiteSpace(_options.BaseUrl)
            ? "https://generativelanguage.googleapis.com/v1beta"
            : _options.BaseUrl.Trim().TrimEnd('/');

        return $"{baseUrl}/models/{Uri.EscapeDataString(model)}:generateContent?key={Uri.EscapeDataString(_options.ApiKey)}";
    }

    private string ResolveModelId()
    {
        return string.IsNullOrWhiteSpace(_options.ModelId)
            ? GeminiOptions.DefaultModelId
            : _options.ModelId.Trim();
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

    private static (string? Text, string? FinishReason) ExtractGenerationResult(string responseBody)
    {
        try
        {
            using var document = JsonDocument.Parse(responseBody);

            if (!document.RootElement.TryGetProperty("candidates", out var candidates) ||
                candidates.ValueKind != JsonValueKind.Array)
            {
                return (null, null);
            }

            foreach (var candidate in candidates.EnumerateArray())
            {
                var finishReason = candidate.TryGetProperty("finishReason", out var finishReasonNode) &&
                                   finishReasonNode.ValueKind == JsonValueKind.String
                    ? finishReasonNode.GetString()
                    : null;

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
                        return (textNode.GetString(), finishReason);
                    }
                }
            }
        }
        catch (JsonException)
        {
            return (null, null);
        }

        return (null, null);
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
                if (number > 1m)
                {
                    number /= 100m;
                }

                return Math.Clamp(number, 0m, 1m);
            }

            if (confidence.ValueKind == JsonValueKind.String &&
                decimal.TryParse(confidence.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed))
            {
                if (parsed > 1m)
                {
                    parsed /= 100m;
                }

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

    private static JsonElement BuildReceiptResponseSchema()
    {
        const string schema = """
        {
          "type": "object",
          "properties": {
            "success": { "type": "boolean" },
            "confidence": { "type": "number" },
            "vendorName": { "type": ["string", "null"] },
            "vendorPhone": { "type": ["string", "null"] },
            "date": { "type": ["string", "null"] },
            "lineItems": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "name": { "type": "string" },
                  "quantity": { "type": ["number", "null"] },
                  "unit": { "type": ["string", "null"] },
                  "unitPrice": { "type": ["number", "null"] },
                  "totalAmount": { "type": ["number", "null"] },
                  "suggestedCategory": {
                    "type": "string",
                    "enum": [
                      "FERTILIZER",
                      "PESTICIDE",
                      "FUNGICIDE",
                      "SEEDS_PLANTS",
                      "IRRIGATION",
                      "LABOUR",
                      "MACHINERY_RENTAL",
                      "FUEL",
                      "TRANSPORT",
                      "PACKAGING",
                      "ELECTRICITY",
                      "EQUIPMENT_REPAIR",
                      "MISC"
                    ]
                  },
                  "confidence": { "type": "number" }
                },
                "required": [ "name", "suggestedCategory", "confidence" ]
              }
            },
            "subtotal": { "type": "number" },
            "discount": { "type": "number" },
            "tax": { "type": "number" },
            "grandTotal": { "type": "number" },
            "suggestedScope": {
              "type": "string",
              "enum": [ "PLOT", "CROP", "FARM", "UNKNOWN" ]
            },
            "suggestedCropName": { "type": ["string", "null"] },
            "rawTextExtracted": { "type": ["string", "null"] },
            "warnings": {
              "type": "array",
              "items": { "type": "string" }
            }
          },
          "required": [
            "success",
            "confidence",
            "lineItems",
            "subtotal",
            "discount",
            "tax",
            "grandTotal",
            "suggestedScope",
            "warnings"
          ]
        }
        """;

        return JsonSerializer.Deserialize<JsonElement>(schema);
    }

    private static JsonElement BuildPattiResponseSchema()
    {
        const string schema = """
        {
          "type": "object",
          "properties": {
            "date": { "type": ["string", "null"] },
            "pattiNumber": { "type": ["string", "null"] },
            "buyerName": { "type": ["string", "null"] },
            "items": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "gradeRaw": { "type": "string" },
                  "quantity": { "type": ["number", "null"] },
                  "unit": { "type": ["string", "null"] },
                  "rate": { "type": ["number", "null"] },
                  "amount": { "type": ["number", "null"] }
                },
                "required": [ "gradeRaw" ]
              }
            },
            "deductions": {
              "type": "object",
              "properties": {
                "commission": { "type": "number" },
                "transport": { "type": "number" },
                "other": { "type": "number" }
              }
            },
            "grossTotal": { "type": "number" },
            "netAmount": { "type": "number" },
            "confidence": { "type": "number" }
          },
          "required": [ "items", "deductions", "grossTotal", "netAmount" ]
        }
        """;

        return JsonSerializer.Deserialize<JsonElement>(schema);
    }

    private static bool LooksMeaningfulReceiptResult(string normalizedJson)
    {
        try
        {
            using var document = JsonDocument.Parse(normalizedJson);
            var root = document.RootElement;

            if (root.TryGetProperty("lineItems", out var items) &&
                items.ValueKind == JsonValueKind.Array &&
                items.GetArrayLength() > 0)
            {
                return true;
            }

            if (root.TryGetProperty("grandTotal", out var grandTotal) &&
                grandTotal.ValueKind == JsonValueKind.Number &&
                grandTotal.TryGetDecimal(out var total) &&
                total > 0m)
            {
                return true;
            }

            if (root.TryGetProperty("vendorName", out var vendorName) &&
                vendorName.ValueKind == JsonValueKind.String &&
                !string.IsNullOrWhiteSpace(vendorName.GetString()))
            {
                return true;
            }

            return root.TryGetProperty("rawTextExtracted", out var rawText) &&
                   rawText.ValueKind == JsonValueKind.String &&
                   !string.IsNullOrWhiteSpace(rawText.GetString());
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static bool LooksMeaningfulPattiResult(string normalizedJson)
    {
        try
        {
            using var document = JsonDocument.Parse(normalizedJson);
            var root = document.RootElement;

            if (root.TryGetProperty("items", out var items) &&
                items.ValueKind == JsonValueKind.Array &&
                items.GetArrayLength() > 0)
            {
                return true;
            }

            if (root.TryGetProperty("netAmount", out var netAmount) &&
                netAmount.ValueKind == JsonValueKind.Number &&
                netAmount.TryGetDecimal(out var amount) &&
                amount > 0m)
            {
                return true;
            }

            return root.TryGetProperty("buyerName", out var buyerName) &&
                   buyerName.ValueKind == JsonValueKind.String &&
                   !string.IsNullOrWhiteSpace(buyerName.GetString());
        }
        catch (JsonException)
        {
            return false;
        }
    }
}
