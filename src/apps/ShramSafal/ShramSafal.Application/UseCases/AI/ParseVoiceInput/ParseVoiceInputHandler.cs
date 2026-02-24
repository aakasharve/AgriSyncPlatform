using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.AI.ParseVoiceInput;

public sealed class ParseVoiceInputHandler(
    IShramSafalRepository repository,
    IAiOrchestrator aiOrchestrator,
    IAiPromptBuilder promptBuilder)
{
    public async Task<Result<VoiceParseResult>> HandleAsync(ParseVoiceInputCommand command, CancellationToken ct = default)
    {
        if (command.UserId == Guid.Empty ||
            command.FarmId == Guid.Empty)
        {
            return Result.Failure<VoiceParseResult>(ShramSafalErrors.InvalidCommand);
        }

        if (command.PlotId.HasValue && command.PlotId.Value == Guid.Empty)
        {
            return Result.Failure<VoiceParseResult>(ShramSafalErrors.InvalidCommand);
        }

        if (command.CropCycleId.HasValue && command.CropCycleId.Value == Guid.Empty)
        {
            return Result.Failure<VoiceParseResult>(ShramSafalErrors.InvalidCommand);
        }

        var transcript = command.TextTranscript?.Trim();
        var hasAudio = !string.IsNullOrWhiteSpace(command.AudioBase64);
        if (string.IsNullOrWhiteSpace(transcript) && !hasAudio)
        {
            return Result.Failure<VoiceParseResult>(ShramSafalErrors.MissingVoiceTranscript);
        }

        var farm = await repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure<VoiceParseResult>(ShramSafalErrors.FarmNotFound);
        }

        var canAccessFarm = await repository.IsUserMemberOfFarmAsync(command.FarmId, command.UserId, ct);
        if (!canAccessFarm)
        {
            return Result.Failure<VoiceParseResult>(ShramSafalErrors.Forbidden);
        }

        Domain.Farms.Plot? plot = null;
        if (command.PlotId.HasValue)
        {
            plot = await repository.GetPlotByIdAsync(command.PlotId.Value, ct);
            if (plot is null || plot.FarmId != farm.Id)
            {
                return Result.Failure<VoiceParseResult>(ShramSafalErrors.PlotNotFound);
            }
        }

        Domain.Crops.CropCycle? cropCycle = null;
        if (command.CropCycleId.HasValue)
        {
            cropCycle = await repository.GetCropCycleByIdAsync(command.CropCycleId.Value, ct);
            if (cropCycle is null || cropCycle.FarmId != farm.Id)
            {
                return Result.Failure<VoiceParseResult>(ShramSafalErrors.CropCycleNotFound);
            }

            if (plot is not null && cropCycle.PlotId != plot.Id)
            {
                return Result.Failure<VoiceParseResult>(ShramSafalErrors.CropCycleNotFound);
            }
        }

        var promptContext = BuildPromptContext(command.ContextJson, farm.Name, plot?.Name, cropCycle?.CropName);
        var systemPrompt = promptBuilder.BuildVoiceParsingPrompt(promptContext);

        await using var payloadStream = BuildPayloadStream(command, transcript, out var mimeType);
        var idempotencyKey = !string.IsNullOrWhiteSpace(command.IdempotencyKey)
            ? command.IdempotencyKey!.Trim()
            : BuildIdempotencyKey(command, transcript, command.AudioBase64);

        try
        {
            var orchestration = await aiOrchestrator.ParseVoiceWithFallbackAsync(
                command.UserId,
                command.FarmId,
                payloadStream,
                mimeType,
                systemPrompt,
                idempotencyKey,
                languageHint: "mr-IN",
                inputSpeechDurationMs: command.InputSpeechDurationMs,
                inputRawDurationMs: command.InputRawDurationMs,
                segmentMetadataJson: command.SegmentMetadataJson,
                requestPayloadHash: command.RequestPayloadHash,
                ct: ct);

            var canonicalResult = orchestration.Result;
            if (!canonicalResult.Success || string.IsNullOrWhiteSpace(canonicalResult.NormalizedJson))
            {
                return Result.Failure<VoiceParseResult>(
                    new Error(
                        ShramSafalErrors.AiParsingFailed.Code,
                        canonicalResult.Error ?? ShramSafalErrors.AiParsingFailed.Description));
            }

            using var document = JsonDocument.Parse(canonicalResult.NormalizedJson);
            var parsedLog = document.RootElement.Clone();
            var fieldConfidences = ExtractFieldConfidences(parsedLog);
            var overallConfidence = canonicalResult.OverallConfidence > 0
                ? canonicalResult.OverallConfidence
                : InferFallbackConfidence(parsedLog);
            var suggestedAction = DetermineSuggestedAction(fieldConfidences, overallConfidence);

            var modelUsed = orchestration.FallbackUsed
                ? $"{orchestration.ProviderUsed}:fallback"
                : orchestration.ProviderUsed.ToString();

            var response = new VoiceParseResult(
                parsedLog,
                decimal.Round(ConfidenceScorePolicy.Normalize(overallConfidence), 4, MidpointRounding.AwayFromZero),
                fieldConfidences,
                suggestedAction,
                modelUsed,
                0,
                "pass");

            return Result.Success(response);
        }
        catch (Exception ex)
        {
            return Result.Failure<VoiceParseResult>(
                new Error(
                    ShramSafalErrors.AiParsingFailed.Code,
                    $"{ShramSafalErrors.AiParsingFailed.Description} {ex.Message}"));
        }
    }

    private static Stream BuildPayloadStream(
        ParseVoiceInputCommand command,
        string? transcript,
        out string mimeType)
    {
        if (!string.IsNullOrWhiteSpace(command.AudioBase64))
        {
            var normalizedBase64 = command.AudioBase64!;
            var commaIndex = normalizedBase64.IndexOf(',');
            if (commaIndex >= 0 && commaIndex < normalizedBase64.Length - 1)
            {
                normalizedBase64 = normalizedBase64[(commaIndex + 1)..];
            }

            var audioBytes = Convert.FromBase64String(normalizedBase64);
            mimeType = string.IsNullOrWhiteSpace(command.AudioMimeType)
                ? "audio/webm"
                : command.AudioMimeType!.Trim();
            return new MemoryStream(audioBytes, writable: false);
        }

        var textBytes = Encoding.UTF8.GetBytes(transcript ?? string.Empty);
        mimeType = "text/plain";
        return new MemoryStream(textBytes, writable: false);
    }

    private static VoiceParseContext BuildPromptContext(
        string? contextJson,
        string farmName,
        string? plotName,
        string? cropName)
    {
        if (!string.IsNullOrWhiteSpace(contextJson))
        {
            try
            {
                var parsed = JsonSerializer.Deserialize<VoiceParseContext>(contextJson);
                if (parsed is not null)
                {
                    return parsed;
                }
            }
            catch (JsonException)
            {
                // Ignore malformed context JSON and fallback to minimal context.
            }
        }

        var selection = new SelectedCropContext(
            CropId: cropName ?? "unknown",
            CropName: cropName ?? "Not specified",
            SelectedPlotIds: plotName is null ? [] : [plotName],
            SelectedPlotNames: plotName is null ? [] : [plotName]);

        return new VoiceParseContext(
            AvailableCrops: [],
            Profile: new FarmerProfileInfo([], [], [], null),
            FarmContext: new FarmContextInfo([selection]),
            FocusCategory: null,
            VocabDb: null);
    }

    private static string BuildIdempotencyKey(
        ParseVoiceInputCommand command,
        string? transcript,
        string? audioBase64)
    {
        var input = $"{command.UserId}|{command.FarmId}|{command.PlotId}|{command.CropCycleId}|{transcript}|{audioBase64}";
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(input));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static Dictionary<string, FieldConfidence> ExtractFieldConfidences(JsonElement parsedLog)
    {
        var result = new Dictionary<string, FieldConfidence>(StringComparer.OrdinalIgnoreCase);

        if (!parsedLog.TryGetProperty("fieldConfidences", out var fieldConfidences) ||
            fieldConfidences.ValueKind != JsonValueKind.Object)
        {
            return result;
        }

        foreach (var property in fieldConfidences.EnumerateObject())
        {
            if (property.Value.ValueKind == JsonValueKind.Number)
            {
                if (property.Value.TryGetDecimal(out var directScore))
                {
                    result[property.Name] = FieldConfidence.Create(directScore);
                }

                continue;
            }

            if (property.Value.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var score = TryReadDecimal(property.Value, "score") ?? 0.50m;
            var reason = TryReadString(property.Value, "reason");
            var levelLabel = TryReadString(property.Value, "level");
            var level = ParseConfidenceLevel(levelLabel, score);
            var normalizedScore = ConfidenceScorePolicy.Normalize(score);
            result[property.Name] = new FieldConfidence(normalizedScore, level, reason);
        }

        return result;
    }

    private static decimal InferFallbackConfidence(JsonElement parsedLog)
    {
        var extractedItemsCount =
            CountArrayItems(parsedLog, "cropActivities") +
            CountArrayItems(parsedLog, "irrigation") +
            CountArrayItems(parsedLog, "labour") +
            CountArrayItems(parsedLog, "inputs") +
            CountArrayItems(parsedLog, "machinery") +
            CountArrayItems(parsedLog, "activityExpenses");

        var score = extractedItemsCount > 0 ? 0.78m : 0.58m;
        if (CountArrayItems(parsedLog, "unclearSegments") > 0)
        {
            score -= 0.10m;
        }

        if (parsedLog.TryGetProperty("dayOutcome", out var dayOutcomeElement) &&
            string.Equals(dayOutcomeElement.GetString(), "IRRELEVANT_INPUT", StringComparison.OrdinalIgnoreCase))
        {
            score = 0.90m;
        }

        return ConfidenceScorePolicy.Normalize(score);
    }

    private static string DetermineSuggestedAction(
        IReadOnlyDictionary<string, FieldConfidence> fieldConfidences,
        decimal overallConfidence)
    {
        if (fieldConfidences.Count == 0)
        {
            if (overallConfidence >= ConfidenceScorePolicy.HighThreshold)
            {
                return "auto_confirm";
            }

            if (overallConfidence >= ConfidenceScorePolicy.MediumThreshold)
            {
                return "review_flagged";
            }

            return "manual_review";
        }

        var lowCount = fieldConfidences.Values.Count(c => c.Level == ConfidenceScore.Low);
        if (lowCount >= 3 || overallConfidence < ConfidenceScorePolicy.MediumThreshold)
        {
            return "save_as_draft";
        }

        if (lowCount > 0)
        {
            return "manual_review";
        }

        if (fieldConfidences.Values.Any(c => c.Level == ConfidenceScore.Medium))
        {
            return "review_flagged";
        }

        return "auto_confirm";
    }

    private static ConfidenceScore ParseConfidenceLevel(string? levelLabel, decimal score)
    {
        if (string.IsNullOrWhiteSpace(levelLabel))
        {
            return ConfidenceScorePolicy.FromScore(score);
        }

        return levelLabel.Trim().ToUpperInvariant() switch
        {
            "HIGH" => ConfidenceScore.High,
            "MEDIUM" => ConfidenceScore.Medium,
            "LOW" => ConfidenceScore.Low,
            _ => ConfidenceScorePolicy.FromScore(score)
        };
    }

    private static decimal? TryReadDecimal(JsonElement source, string propertyName)
    {
        if (!source.TryGetProperty(propertyName, out var property))
        {
            return null;
        }

        return property.ValueKind switch
        {
            JsonValueKind.Number when property.TryGetDecimal(out var numericValue) => numericValue,
            JsonValueKind.String when decimal.TryParse(
                property.GetString(),
                NumberStyles.Float,
                CultureInfo.InvariantCulture,
                out var parsed) => parsed,
            _ => null
        };
    }

    private static string? TryReadString(JsonElement source, string propertyName)
    {
        if (!source.TryGetProperty(propertyName, out var property) || property.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return property.GetString();
    }

    private static int CountArrayItems(JsonElement source, string propertyName)
    {
        return source.TryGetProperty(propertyName, out var arrayNode) && arrayNode.ValueKind == JsonValueKind.Array
            ? arrayNode.GetArrayLength()
            : 0;
    }
}
