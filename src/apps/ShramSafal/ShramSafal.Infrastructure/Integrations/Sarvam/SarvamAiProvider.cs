using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.AI;
using ShramSafal.Infrastructure.AI;
using ShramSafal.Infrastructure.Integrations.Gemini;

namespace ShramSafal.Infrastructure.Integrations.Sarvam;

internal sealed class SarvamAiProvider(
    SarvamSttClient sttClient,
    SarvamChatClient chatClient,
    SarvamVisionClient visionClient,
    IOptions<SarvamOptions> optionsAccessor,
    AiResponseNormalizer responseNormalizer,
    ILogger<SarvamAiProvider> logger) : IAiProvider
{
    private readonly SarvamOptions _options = optionsAccessor.Value;

    public AiProviderType ProviderType => AiProviderType.Sarvam;

    public bool CanHandle(AiOperationType operation)
    {
        return operation is AiOperationType.VoiceToStructuredLog;
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
            var sttPieces = 1;
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
                sttPieces = stt.Pieces;
            }

            if (string.IsNullOrWhiteSpace(transcript))
            {
                return new VoiceParseCanonicalResult
                {
                    Success = false,
                    Error = "Sarvam STT returned an empty transcript."
                };
            }

            // PLR lane V-1 fix pass (B001) — a transcript too long for one answer is structured in segments, all or
            // nothing. A correction ("बदला") is never segmented: its block asks for whole buckets, which segments
            // would repeat.
            var isCorrection = CorrectionPromptData.IsCorrectionPrompt(systemPrompt);
            var segmentTokens = isCorrection
                ? int.MaxValue
                : new StructuringBudget(_options.ChatMaxTokens > 0 ? _options.ChatMaxTokens : 2048).SegmentTokens;
            var structured = await ChunkedStructuring.StructureAsync(
                transcript,
                segmentTokens,
                async (segment, segmentCt) =>
                {
                    var completion = await chatClient.CompleteAsync(systemPrompt, segment, segmentCt);
                    var spoken = StructuringBudget.EstimateTokens(segment);
                    if (!completion.IsSuccess)
                    {
                        if (completion.Error != SarvamChatClient.CutOffError)
                        {
                            return SegmentAnswer.Failed(completion.Error, retryable: true);
                        }

                        // Fix pass 2: what the cut answer was made of, and what the API said about it (item c).
                        logger.LogWarning(
                            "Sarvam structurer answer CUT OFF for ~{SpokenTokens} transcript tokens. Usage as returned: {Usage}. Reasoning text: {Reasoning}. Answer so far: {Census}.",
                            spoken,
                            completion.Usage ?? "(none)",
                            completion.ReasoningChars?.ToString(CultureInfo.InvariantCulture) ?? "none",
                            AnswerCensus.Describe(completion.PartialContent));
                        return SegmentAnswer.CutOffAnswer(completion.Error);
                    }

                    // Measured, not assumed: the answer size against the transcript size the budget planned for.
                    logger.LogInformation(
                        "Sarvam structurer answer: {CompletionTokens} completion tokens for ~{SpokenTokens} transcript tokens (planned at most {Planned}). Usage as returned: {Usage}. Answer: {Census}.",
                        completion.CompletionTokens?.ToString(CultureInfo.InvariantCulture) ?? "unknown",
                        spoken,
                        StructuringBudget.PredictedAnswerTokens(spoken),
                        completion.Usage ?? "(none)",
                        AnswerCensus.Describe(completion.Content));
                    return SegmentAnswer.Ok(completion.Content);
                },
                logger,
                ct,
                allowSplit: !isCorrection);
            if (!structured.IsSuccess)
            {
                // B005: after a split recording, the error tells the orchestrator not to transcribe it all again.
                return new VoiceParseCanonicalResult
                {
                    Success = false,
                    Error = AiErrorMarkers.ForSplitRecording(structured.Error ?? "Sarvam structurer failed.", sttPieces)
                };
            }

            var cleaned = GeminiJsonCleaner.Clean(structured.Content ?? "{}");
            var promptVersion = AiPromptLineage.ResolvePromptVersion(systemPrompt);
            // PLR lane V-1 — the server holds the transcript; the model no longer repeats it (its answer must fit).
            var normalized = responseNormalizer.NormalizeVoiceJson(cleaned, promptVersion: promptVersion, serverTranscript: transcript);
            var confidence = TryExtractConfidence(normalized) ?? 0.75m;

            return new VoiceParseCanonicalResult
            {
                Success = true,
                ModelUsed = $"{_options.SttModel}+{_options.ChatModel}",
                PromptVersion = promptVersion,
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
                ModelUsed = $"{_options.VisionModel}+{_options.ChatModel}",
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
