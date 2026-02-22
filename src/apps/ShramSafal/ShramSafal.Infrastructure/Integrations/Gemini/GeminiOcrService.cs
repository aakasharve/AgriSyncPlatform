using System.Diagnostics;
using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.OCR;

namespace ShramSafal.Infrastructure.Integrations.Gemini;

internal sealed class GeminiOcrService(IOptions<GeminiOptions> optionsAccessor) : IOcrExtractionService
{
    private static readonly HttpClient HttpClient = new();
    private readonly GeminiOptions _options = optionsAccessor.Value;

    public async Task<OcrExtractionResult> ExtractFromImageAsync(Stream imageStream, string mimeType, OcrContext context, CancellationToken ct)
    {
        var stopwatch = Stopwatch.StartNew();

        try
        {
            await using var memory = new MemoryStream();
            await imageStream.CopyToAsync(memory, ct);
            var bytes = memory.ToArray();
            if (bytes.Length == 0)
            {
                stopwatch.Stop();
                return CreateEmptyResult(ResolveModelName(), (int)stopwatch.ElapsedMilliseconds);
            }

            var model = ResolveModelName();
            var apiKey = _options.ApiKey?.Trim();
            if (string.IsNullOrWhiteSpace(apiKey))
            {
                stopwatch.Stop();
                return CreateEmptyResult(model, (int)stopwatch.ElapsedMilliseconds);
            }

            var endpoint =
                $"https://generativelanguage.googleapis.com/v1beta/models/{Uri.EscapeDataString(model)}:generateContent?key={Uri.EscapeDataString(apiKey)}";

            var requestBody = new
            {
                systemInstruction = new
                {
                    parts = new[]
                    {
                        new { text = BuildSystemPrompt(context) }
                    }
                },
                contents = new[]
                {
                    new
                    {
                        role = "user",
                        parts = new object[]
                        {
                            new { text = "Extract receipt fields from this image." },
                            new
                            {
                                inlineData = new
                                {
                                    mimeType = string.IsNullOrWhiteSpace(mimeType) ? "image/jpeg" : mimeType.Trim(),
                                    data = Convert.ToBase64String(bytes)
                                }
                            }
                        }
                    }
                },
                generationConfig = new
                {
                    responseMimeType = "application/json",
                    temperature = _options.Temperature,
                    maxOutputTokens = _options.MaxTokens
                }
            };

            using var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
            {
                Content = JsonContent.Create(requestBody)
            };

            using var response = await HttpClient.SendAsync(request, ct);
            var responseBody = await response.Content.ReadAsStringAsync(ct);
            stopwatch.Stop();

            if (!response.IsSuccessStatusCode)
            {
                return CreateEmptyResult(model, (int)stopwatch.ElapsedMilliseconds);
            }

            var generated = ExtractGeneratedText(responseBody);
            if (string.IsNullOrWhiteSpace(generated))
            {
                return CreateEmptyResult(model, (int)stopwatch.ElapsedMilliseconds);
            }

            return ParseExtractionResult(generated, model, (int)stopwatch.ElapsedMilliseconds);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch
        {
            stopwatch.Stop();
            return CreateEmptyResult(ResolveModelName(), (int)stopwatch.ElapsedMilliseconds);
        }
    }

    private string ResolveModelName()
    {
        return string.IsNullOrWhiteSpace(_options.Model) ? "gemini-2.0-flash" : _options.Model.Trim();
    }

    private static OcrExtractionResult ParseExtractionResult(string jsonText, string modelName, int latencyMs)
    {
        JsonNode? parsed;
        try
        {
            parsed = JsonNode.Parse(CleanJson(jsonText));
        }
        catch (JsonException)
        {
            return CreateEmptyResult(modelName, latencyMs);
        }

        if (parsed is not JsonObject root)
        {
            return CreateEmptyResult(modelName, latencyMs);
        }

        var rawText = ReadString(root, "rawText") ?? ReadString(root, "text") ?? string.Empty;
        var modelUsed = ReadString(root, "modelUsed") ?? modelName;
        var confidence = ReadDecimal(root, "overallConfidence") ?? 0m;

        if (confidence > 1m)
        {
            confidence = confidence / 100m;
        }

        var fields = new List<ExtractedField>();
        if (root["fields"] is JsonArray fieldsNode)
        {
            foreach (var node in fieldsNode)
            {
                if (node is not JsonObject fieldObject)
                {
                    continue;
                }

                var fieldName = ReadString(fieldObject, "fieldName")
                                ?? ReadString(fieldObject, "name")
                                ?? ReadString(fieldObject, "key")
                                ?? string.Empty;
                var value = ReadString(fieldObject, "value") ?? string.Empty;
                var fieldConfidence = ReadDecimal(fieldObject, "confidence") ?? 0m;
                if (fieldConfidence > 1m)
                {
                    fieldConfidence /= 100m;
                }

                fields.Add(new ExtractedField
                {
                    FieldName = fieldName.Trim(),
                    Value = value.Trim(),
                    Confidence = NormalizeConfidence(fieldConfidence)
                });
            }
        }

        return new OcrExtractionResult
        {
            AttachmentId = Guid.Empty,
            RawText = rawText.Trim(),
            Fields = fields,
            OverallConfidence = NormalizeConfidence(confidence),
            ModelUsed = modelUsed.Trim(),
            LatencyMs = latencyMs,
            ExtractedAtUtc = DateTime.UtcNow
        };
    }

    private static OcrExtractionResult CreateEmptyResult(string modelName, int latencyMs)
    {
        return new OcrExtractionResult
        {
            AttachmentId = Guid.Empty,
            RawText = string.Empty,
            Fields = [],
            OverallConfidence = 0m,
            ModelUsed = modelName,
            LatencyMs = latencyMs,
            ExtractedAtUtc = DateTime.UtcNow
        };
    }

    private static string BuildSystemPrompt(OcrContext context)
    {
        var categories = context.RecentCategories?.Length > 0
            ? string.Join(", ", context.RecentCategories.Take(15))
            : "Unknown";
        var vendors = context.RecentVendors?.Length > 0
            ? string.Join(", ", context.RecentVendors.Take(15))
            : "Unknown";

        return $$"""
        You are an OCR extraction engine for agricultural receipts.
        Read the image and return strict JSON only.

        Context:
        - Farm: {{context.FarmName}}
        - Recent categories: {{categories}}
        - Recent vendors: {{vendors}}

        Extract these fields:
        - rawText (string)
        - overallConfidence (0 to 1)
        - fields (array):
          - fieldName (one of: amount, vendor, date, category, items)
          - value (string)
          - confidence (0 to 1)
        """;
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

    private static string CleanJson(string rawText)
    {
        var text = rawText
            .Replace("```json", string.Empty, StringComparison.OrdinalIgnoreCase)
            .Replace("```", string.Empty, StringComparison.OrdinalIgnoreCase)
            .Trim();

        var firstBrace = text.IndexOf('{');
        var lastBrace = text.LastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace)
        {
            return text[firstBrace..(lastBrace + 1)];
        }

        return text;
    }

    private static string? ReadString(JsonObject root, string propertyName)
    {
        if (root[propertyName] is JsonValue value && value.TryGetValue<string>(out var text))
        {
            return text;
        }

        return null;
    }

    private static decimal? ReadDecimal(JsonObject root, string propertyName)
    {
        if (root[propertyName] is not JsonValue value)
        {
            return null;
        }

        if (value.TryGetValue<decimal>(out var decimalValue))
        {
            return decimalValue;
        }

        if (value.TryGetValue<double>(out var doubleValue))
        {
            return Convert.ToDecimal(doubleValue, CultureInfo.InvariantCulture);
        }

        if (value.TryGetValue<string>(out var text) &&
            decimal.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed))
        {
            return parsed;
        }

        return null;
    }

    private static decimal NormalizeConfidence(decimal confidence)
    {
        if (confidence < 0m)
        {
            return 0m;
        }

        if (confidence > 1m)
        {
            return 1m;
        }

        return decimal.Round(confidence, 4, MidpointRounding.AwayFromZero);
    }
}
