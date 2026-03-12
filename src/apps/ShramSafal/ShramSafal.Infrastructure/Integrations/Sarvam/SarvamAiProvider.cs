using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.AI;
using ShramSafal.Infrastructure.AI;
using ShramSafal.Infrastructure.Integrations.Gemini;

namespace ShramSafal.Infrastructure.Integrations.Sarvam;

internal sealed class SarvamAiProvider(
    SarvamSttClient sttClient,
    SarvamChatClient chatClient,
    SarvamVisionClient visionClient,
    AiResponseNormalizer responseNormalizer,
    ILogger<SarvamAiProvider> logger) : IAiProvider
{
    public AiProviderType ProviderType => AiProviderType.Sarvam;

    public bool CanHandle(AiOperationType operation)
    {
        return operation is AiOperationType.VoiceToStructuredLog or
               AiOperationType.ReceiptToExpenseItems or
               AiOperationType.PattiImageToSaleData;
    }

    public async Task<bool> HealthCheckAsync(CancellationToken ct = default)
    {
        var ping = await chatClient.CompleteAsync(
            "You are a health check endpoint. Reply with PONG.",
            "ping",
            ct);

        return ping.IsSuccess && !string.IsNullOrWhiteSpace(ping.Content);
    }

    public async Task<VoiceParseCanonicalResult> ParseVoiceAsync(
        Stream audioStream,
        string mimeType,
        string languageHint,
        string systemPrompt,
        CancellationToken ct = default)
    {
        try
        {
            string transcript;
            if (mimeType.StartsWith("text/", StringComparison.OrdinalIgnoreCase))
            {
                transcript = await ReadTextAsync(audioStream, ct);
            }
            else
            {
                var stt = await sttClient.TranscribeAsync(audioStream, mimeType, languageHint, ct);
                if (!stt.IsSuccess)
                {
                    return new VoiceParseCanonicalResult
                    {
                        Success = false,
                        Error = stt.Error
                    };
                }

                transcript = stt.Transcript ?? string.Empty;
            }

            if (string.IsNullOrWhiteSpace(transcript))
            {
                return new VoiceParseCanonicalResult
                {
                    Success = false,
                    Error = "Sarvam STT returned an empty transcript."
                };
            }

            var completion = await chatClient.CompleteAsync(systemPrompt, transcript, ct);
            if (!completion.IsSuccess)
            {
                return new VoiceParseCanonicalResult
                {
                    Success = false,
                    Error = completion.Error
                };
            }

            var cleaned = GeminiJsonCleaner.Clean(completion.Content ?? "{}");
            var normalized = responseNormalizer.NormalizeVoiceJson(cleaned);
            var confidence = TryExtractConfidence(normalized) ?? 0.75m;

            return new VoiceParseCanonicalResult
            {
                Success = true,
                RawTranscript = transcript,
                NormalizedJson = normalized,
                OverallConfidence = confidence
            };
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Sarvam ParseVoiceAsync failed.");
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
        try
        {
            var ocr = await visionClient.ExtractTextAsync(imageStream, mimeType, ct);
            if (!ocr.IsSuccess)
            {
                return new ReceiptExtractCanonicalResult
                {
                    Success = false,
                    Error = ocr.Error
                };
            }

            var extractedText = ocr.ExtractedText ?? string.Empty;
            if (string.IsNullOrWhiteSpace(extractedText))
            {
                return new ReceiptExtractCanonicalResult
                {
                    Success = false,
                    Error = "Sarvam vision returned empty text."
                };
            }

            var completion = await chatClient.CompleteAsync(systemPrompt, extractedText, ct);
            if (!completion.IsSuccess)
            {
                return new ReceiptExtractCanonicalResult
                {
                    Success = false,
                    Error = completion.Error
                };
            }

            var cleaned = GeminiJsonCleaner.Clean(completion.Content ?? "{}");
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
            logger.LogError(ex, "Sarvam image extraction failed.");
            return new ReceiptExtractCanonicalResult
            {
                Success = false,
                Error = ex.Message
            };
        }
    }

    private static async Task<string> ReadTextAsync(Stream stream, CancellationToken ct)
    {
        if (stream.CanSeek)
        {
            stream.Position = 0;
        }

        using var reader = new StreamReader(stream, leaveOpen: true);
        var text = await reader.ReadToEndAsync(ct);
        return text.Trim();
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
}
