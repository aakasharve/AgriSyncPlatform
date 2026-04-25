using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.AI.ParseVoiceInput;

public sealed class ParseVoiceInputHandler(
    IShramSafalRepository repository,
    IAiOrchestrator aiOrchestrator,
    IAiPromptBuilder promptBuilder,
    IEntitlementPolicy entitlementPolicy,
    IAnalyticsWriter analytics,
    IClock clock)
{
    private static readonly Dictionary<string, int> MarathiNumberTokens = new(StringComparer.OrdinalIgnoreCase)
    {
        ["एक"] = 1,
        ["दोघांनी"] = 2,
        ["दोन"] = 2,
        ["तिघांनी"] = 3,
        ["तिघे"] = 3,
        ["तीन"] = 3,
        ["चौघांनी"] = 4,
        ["चौघे"] = 4,
        ["चार"] = 4,
        ["पाचजणांनी"] = 5,
        ["पाचजण"] = 5,
        ["पाच"] = 5,
        ["सहाजणांनी"] = 6,
        ["सहाजण"] = 6,
        ["सहा"] = 6,
        ["सात"] = 7,
        ["आठ"] = 8,
        ["नऊ"] = 9,
        ["दहा"] = 10,
    };

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

        var gate = await EntitlementGate.CheckAsync<VoiceParseResult>(
            entitlementPolicy,
            new UserId(command.UserId),
            new FarmId(command.FarmId),
            PaidFeature.AiParse,
            ct);
        if (gate is not null)
        {
            return gate;
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

        var stopwatch = Stopwatch.StartNew();
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
            stopwatch.Stop();

            var canonicalResult = orchestration.Result;
            if (!canonicalResult.Success || string.IsNullOrWhiteSpace(canonicalResult.NormalizedJson))
            {
                await EmitAiInvocationAsync(
                    command,
                    providerUsed: orchestration.ProviderUsed.ToString(),
                    jobId: orchestration.JobId,
                    fallbackUsed: orchestration.FallbackUsed,
                    latencyMs: stopwatch.ElapsedMilliseconds,
                    success: false,
                    overallConfidence: null,
                    error: canonicalResult.Error,
                    modelUsed: canonicalResult.ModelUsed,
                    promptVersion: canonicalResult.PromptVersion,
                    validationOutcome: "provider_fail",
                    fieldConfidenceCount: null,
                    ct: ct);

                return Result.Failure<VoiceParseResult>(
                    new Error(
                        ShramSafalErrors.AiParsingFailed.Code,
                        canonicalResult.Error ?? ShramSafalErrors.AiParsingFailed.Description));
            }

            using var document = JsonDocument.Parse(
                ApplyTranscriptIntegrityCorrections(
                    canonicalResult.NormalizedJson,
                    canonicalResult.RawTranscript ?? transcript ?? string.Empty));
            var parsedLog = document.RootElement.Clone();
            var fieldConfidences = ExtractFieldConfidences(parsedLog);
            var overallConfidence = canonicalResult.OverallConfidence > 0
                ? canonicalResult.OverallConfidence
                : InferFallbackConfidence(parsedLog);
            var suggestedAction = DetermineSuggestedAction(fieldConfidences, overallConfidence);

            var providerUsed = orchestration.ProviderUsed.ToString();
            var modelUsed = string.IsNullOrWhiteSpace(canonicalResult.ModelUsed)
                ? providerUsed
                : canonicalResult.ModelUsed.Trim();

            var response = new VoiceParseResult(
                parsedLog,
                decimal.Round(ConfidenceScorePolicy.Normalize(overallConfidence), 4, MidpointRounding.AwayFromZero),
                fieldConfidences,
                suggestedAction,
                modelUsed,
                canonicalResult.PromptVersion,
                providerUsed,
                orchestration.FallbackUsed,
                0,
                "pass");

            await EmitAiInvocationAsync(
                command,
                providerUsed: providerUsed,
                jobId: orchestration.JobId,
                fallbackUsed: orchestration.FallbackUsed,
                latencyMs: stopwatch.ElapsedMilliseconds,
                success: true,
                overallConfidence: response.Confidence,
                error: null,
                modelUsed: modelUsed,
                promptVersion: canonicalResult.PromptVersion,
                validationOutcome: response.ValidationOutcome,
                fieldConfidenceCount: fieldConfidences.Count,
                ct: ct);

            return Result.Success(response);
        }
        catch (Exception ex)
        {
            stopwatch.Stop();
            await EmitAiInvocationAsync(
                command,
                providerUsed: "unknown",
                jobId: Guid.Empty,
                fallbackUsed: false,
                latencyMs: stopwatch.ElapsedMilliseconds,
                success: false,
                overallConfidence: null,
                error: ex.Message,
                modelUsed: null,
                promptVersion: null,
                validationOutcome: "exception",
                fieldConfidenceCount: null,
                ct: ct);

            return Result.Failure<VoiceParseResult>(
                new Error(
                    ShramSafalErrors.AiParsingFailed.Code,
                    $"{ShramSafalErrors.AiParsingFailed.Description} {ex.Message}"));
        }
    }

    private Task EmitAiInvocationAsync(
        ParseVoiceInputCommand command,
        string providerUsed,
        Guid jobId,
        bool fallbackUsed,
        long latencyMs,
        bool success,
        decimal? overallConfidence,
        string? error,
        string? modelUsed,
        string? promptVersion,
        string? validationOutcome,
        int? fieldConfidenceCount,
        CancellationToken ct)
    {
        return analytics.EmitAsync(new AnalyticsEvent(
            EventId: Guid.NewGuid(),
            EventType: AnalyticsEventType.AiInvocation,
            OccurredAtUtc: clock.UtcNow,
            ActorUserId: new UserId(command.UserId),
            FarmId: new FarmId(command.FarmId),
            OwnerAccountId: null,
            ActorRole: "operator",
            Trigger: "voice",
            DeviceOccurredAtUtc: null,
            SchemaVersion: "v1",
            PropsJson: JsonSerializer.Serialize(new
            {
                operation = "voice.parse",
                jobId,
                providerUsed,
                fallbackUsed,
                latencyMs,
                outcome = success ? "success" : "failure",
                overallConfidence,
                modelUsed,
                promptVersion,
                validationOutcome,
                fieldConfidenceCount,
                inputSpeechDurationMs = command.InputSpeechDurationMs,
                inputRawDurationMs = command.InputRawDurationMs,
                hasAudio = !string.IsNullOrWhiteSpace(command.AudioBase64),
                hasTextTranscript = !string.IsNullOrWhiteSpace(command.TextTranscript),
                requestPayloadHashPresent = !string.IsNullOrWhiteSpace(command.RequestPayloadHash),
                error
            })
        ), ct);
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
                var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
                var parsed = JsonSerializer.Deserialize<VoiceParseContext>(contextJson, options);
                if (parsed is not null
                    && parsed.AvailableCrops is not null
                    && parsed.Profile is not null)
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

    private static string ApplyTranscriptIntegrityCorrections(string normalizedJson, string transcript)
    {
        if (string.IsNullOrWhiteSpace(normalizedJson))
        {
            return normalizedJson;
        }

        JsonObject root;
        try
        {
            root = JsonNode.Parse(normalizedJson)?.AsObject() ?? new JsonObject();
        }
        catch (JsonException)
        {
            return normalizedJson;
        }

        var cleanTranscript = transcript.Trim();
        if (cleanTranscript.Length == 0)
        {
            return normalizedJson;
        }

        root["fullTranscript"] = cleanTranscript;

        var labourSegments = ExtractCompoundLabourSegments(cleanTranscript);
        if (labourSegments.Count > 0)
        {
            var labour = new JsonArray();
            foreach (var segment in labourSegments)
            {
                labour.Add(new JsonObject
                {
                    ["type"] = "HIRED",
                    ["count"] = segment.Count,
                    ["activity"] = segment.Activity,
                    ["sourceText"] = segment.SourceText,
                    ["systemInterpretation"] = $"{segment.Count} मजुरांनी {segment.ActivityDisplay} काम केले"
                });
            }

            root["labour"] = labour;

            if (labourSegments.Any(segment => segment.Activity == "fertilizer_application"))
            {
                var inputs = root["inputs"] as JsonArray ?? new JsonArray();
                if (inputs.Count == 0)
                {
                    inputs.Add(new JsonObject
                    {
                        ["productName"] = "खत",
                        ["method"] = "Soil",
                        ["type"] = "fertilizer",
                        ["sourceText"] = labourSegments.First(segment => segment.Activity == "fertilizer_application").SourceText,
                        ["systemInterpretation"] = "खत टाकण्याचे काम नोंदवले"
                    });
                }
                root["inputs"] = inputs;
            }

            if (labourSegments.Any(segment => segment.Activity == "irrigation"))
            {
                var irrigation = root["irrigation"] as JsonArray ?? new JsonArray();
                if (irrigation.Count == 0)
                {
                    irrigation.Add(new JsonObject
                    {
                        ["method"] = "Flood",
                        ["sourceText"] = labourSegments.First(segment => segment.Activity == "irrigation").SourceText,
                        ["systemInterpretation"] = "पाणी सोडण्याचे काम नोंदवले"
                    });
                }
                root["irrigation"] = irrigation;
            }
        }

        if (TryExtractGenderSplit(cleanTranscript, out var maleCount, out var femaleCount))
        {
            root["labour"] = new JsonArray
            {
                new JsonObject
                {
                    ["type"] = "HIRED",
                    ["maleCount"] = maleCount,
                    ["femaleCount"] = femaleCount,
                    ["count"] = maleCount + femaleCount,
                    ["activity"] = "field_work",
                    ["sourceText"] = cleanTranscript,
                    ["systemInterpretation"] = $"{maleCount} पुरुष आणि {femaleCount} महिला मजूर कामावर होते"
                }
            };
        }

        // Safety net: ensure fertilizer application is captured when explicitly stated with a past-tense verb
        if (ContainsFertilizerApplication(cleanTranscript))
        {
            var inputs = root["inputs"] as JsonArray ?? new JsonArray();
            if (inputs.Count == 0)
            {
                inputs.Add(new JsonObject
                {
                    ["productName"] = "खत",
                    ["method"] = "Soil",
                    ["type"] = "fertilizer",
                    ["sourceText"] = cleanTranscript,
                    ["systemInterpretation"] = "खत देण्याचे काम नोंदवले"
                });
                root["inputs"] = inputs;
            }
        }

        if (ContainsIssueSignal(cleanTranscript))
        {
            var observations = root["observations"] as JsonArray ?? new JsonArray();
            if (!observations.Any(node => node?["noteType"]?.GetValue<string>() == "issue"))
            {
                observations.Add(new JsonObject
                {
                    ["noteType"] = "issue",
                    ["textRaw"] = cleanTranscript,
                    ["textCleaned"] = cleanTranscript,
                    ["severity"] = "important",
                    ["sourceText"] = cleanTranscript
                });
            }
            root["observations"] = observations;
        }

        if (ContainsFutureIntent(cleanTranscript))
        {
            var observations = root["observations"] as JsonArray ?? new JsonArray();
            var plannedTasks = root["plannedTasks"] as JsonArray ?? new JsonArray();
            if (!plannedTasks.Any())
            {
                plannedTasks.Add(new JsonObject
                {
                    ["title"] = InferReminderTitle(cleanTranscript),
                    ["dueHint"] = "उद्या",
                    ["sourceText"] = cleanTranscript
                });
            }

            if (!observations.Any(node => node?["noteType"]?.GetValue<string>() == "reminder"))
            {
                observations.Add(new JsonObject
                {
                    ["noteType"] = "reminder",
                    ["textRaw"] = cleanTranscript,
                    ["textCleaned"] = cleanTranscript,
                    ["sourceText"] = cleanTranscript
                });
            }

            root["observations"] = observations;
            root["plannedTasks"] = plannedTasks;
        }

        return root.ToJsonString();
    }

    private static List<(int Count, string Activity, string ActivityDisplay, string SourceText)> ExtractCompoundLabourSegments(string transcript)
    {
        var results = new List<(int Count, string Activity, string ActivityDisplay, string SourceText)>();
        var segments = Regex.Split(transcript, @"\s+आणि\s+|,\s*|。\s*|।\s*|\.\s*")
            .Select(segment => segment.Trim())
            .Where(segment => !string.IsNullOrWhiteSpace(segment))
            .ToList();

        foreach (var segment in segments)
        {
            var count = TryExtractCount(segment);
            if (!count.HasValue)
            {
                continue;
            }

            var activity = InferLabourActivity(segment);
            if (activity is null)
            {
                continue;
            }

            results.Add((count.Value, activity.Value.Activity, activity.Value.ActivityDisplay, segment));
        }

        return results;
    }

    private static int? TryExtractCount(string value)
    {
        foreach (var token in MarathiNumberTokens.OrderByDescending(item => item.Key.Length))
        {
            if (value.Contains(token.Key, StringComparison.OrdinalIgnoreCase))
            {
                return token.Value;
            }
        }

        var digitMatch = Regex.Match(value, @"\b(\d+)\b");
        if (digitMatch.Success && int.TryParse(digitMatch.Groups[1].Value, out var parsed))
        {
            return parsed;
        }

        return null;
    }

    private static (string Activity, string ActivityDisplay)? InferLabourActivity(string value)
    {
        if (value.Contains("नांगर", StringComparison.OrdinalIgnoreCase))
        {
            return ("tillage", "नांगरणीचे");
        }

        if (value.Contains("खत", StringComparison.OrdinalIgnoreCase))
        {
            return ("fertilizer_application", "खत टाकण्याचे");
        }

        if (value.Contains("पाणी", StringComparison.OrdinalIgnoreCase) && (value.Contains("सोड", StringComparison.OrdinalIgnoreCase) || value.Contains("दिले", StringComparison.OrdinalIgnoreCase)))
        {
            return ("irrigation", "पाणी देण्याचे");
        }

        if (value.Contains("फवार", StringComparison.OrdinalIgnoreCase))
        {
            return ("spraying", "फवारणीचे");
        }

        if (value.Contains("छाट", StringComparison.OrdinalIgnoreCase))
        {
            return ("pruning", "छाटणीचे");
        }

        if (value.Contains("निंदण", StringComparison.OrdinalIgnoreCase))
        {
            return ("weeding", "निंदणीचे");
        }

        if (value.Contains("पाने", StringComparison.OrdinalIgnoreCase) && value.Contains("काढ", StringComparison.OrdinalIgnoreCase))
        {
            return ("leaf_removal", "पाने काढण्याचे");
        }

        return null;
    }

    private static bool TryExtractGenderSplit(string transcript, out int maleCount, out int femaleCount)
    {
        maleCount = 0;
        femaleCount = 0;

        var maleMatch = Regex.Match(transcript, @"(एक|दोन|तीन|चार|पाच|सहा|सात|आठ|नऊ|दहा|\d+)\s+पुरुष");
        var femaleMatch = Regex.Match(transcript, @"(एक|दोन|तीन|चार|पाच|सहा|सात|आठ|नऊ|दहा|\d+)\s+बायका");

        if (!maleMatch.Success || !femaleMatch.Success)
        {
            return false;
        }

        maleCount = TryExtractCount(maleMatch.Value) ?? 0;
        femaleCount = TryExtractCount(femaleMatch.Value) ?? 0;
        return maleCount > 0 || femaleCount > 0;
    }

    private static bool ContainsFertilizerApplication(string transcript)
    {
        return transcript.Contains("खत", StringComparison.OrdinalIgnoreCase)
               && (transcript.Contains("दिलं", StringComparison.OrdinalIgnoreCase)
                   || transcript.Contains("दिले", StringComparison.OrdinalIgnoreCase)
                   || transcript.Contains("घातले", StringComparison.OrdinalIgnoreCase)
                   || transcript.Contains("टाकले", StringComparison.OrdinalIgnoreCase));
    }

    private static bool ContainsIssueSignal(string transcript)
    {
        return transcript.Contains("पिवळी", StringComparison.OrdinalIgnoreCase)
               || transcript.Contains("किडे", StringComparison.OrdinalIgnoreCase)
               || transcript.Contains("रोग", StringComparison.OrdinalIgnoreCase)
               || transcript.Contains("समस्या", StringComparison.OrdinalIgnoreCase)
               || transcript.Contains("खराब", StringComparison.OrdinalIgnoreCase)
               || transcript.Contains("डाग", StringComparison.OrdinalIgnoreCase)
               || transcript.Contains("बंद पडली", StringComparison.OrdinalIgnoreCase)
               || transcript.Contains("नुकसान", StringComparison.OrdinalIgnoreCase);
    }

    private static bool ContainsFutureIntent(string transcript)
    {
        return transcript.Contains("उद्या", StringComparison.OrdinalIgnoreCase)
               || transcript.Contains("करायचं", StringComparison.OrdinalIgnoreCase)
               || transcript.Contains("करणार", StringComparison.OrdinalIgnoreCase)
               || transcript.Contains("आणायचं", StringComparison.OrdinalIgnoreCase)
               || transcript.Contains("द्यायचं", StringComparison.OrdinalIgnoreCase)
               || transcript.Contains("घ्यायचं", StringComparison.OrdinalIgnoreCase);
    }

    private static string InferReminderTitle(string transcript)
    {
        // Extract the sentence that contains the future intent to pick the right action
        var sentences = Regex.Split(transcript, @"[.।,]\s*")
            .Select(s => s.Trim())
            .Where(s => s.Length > 0)
            .ToList();

        var futureSentence = sentences.FirstOrDefault(s =>
            s.Contains("उद्या", StringComparison.OrdinalIgnoreCase)
            || s.Contains("करायचं", StringComparison.OrdinalIgnoreCase)
            || s.Contains("आणायचं", StringComparison.OrdinalIgnoreCase)
            || s.Contains("द्यायचं", StringComparison.OrdinalIgnoreCase)
            || s.Contains("घ्यायचं", StringComparison.OrdinalIgnoreCase)) ?? transcript;

        if (futureSentence.Contains("औषध", StringComparison.OrdinalIgnoreCase))
        {
            return "औषध आणणे";
        }

        if (futureSentence.Contains("फवार", StringComparison.OrdinalIgnoreCase))
        {
            return "फवारणी करणे";
        }

        if (futureSentence.Contains("खत", StringComparison.OrdinalIgnoreCase))
        {
            return "खत टाकणे";
        }

        if (futureSentence.Contains("पाणी", StringComparison.OrdinalIgnoreCase))
        {
            return "पाणी देणे";
        }

        if (futureSentence.Contains("मजूर", StringComparison.OrdinalIgnoreCase) || futureSentence.Contains("labour", StringComparison.OrdinalIgnoreCase))
        {
            return "मजूर बोलवणे";
        }

        return "काम करणे";
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
                    result[property.Name] = FieldConfidence.Create(
                        directScore,
                        bucketId: ResolveVisibleBucketId(property.Name));
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
            var bucketId = TryReadString(property.Value, "bucketId") ?? ResolveVisibleBucketId(property.Name);
            var level = ParseConfidenceLevel(levelLabel, score);
            var normalizedScore = ConfidenceScorePolicy.Normalize(score);
            result[property.Name] = new FieldConfidence(normalizedScore, level, reason, bucketId);
        }

        return result;
    }

    private static string? ResolveVisibleBucketId(string fieldPath)
    {
        if (string.IsNullOrWhiteSpace(fieldPath))
        {
            return null;
        }

        var root = fieldPath.Trim();
        var bracketIndex = root.IndexOf('[');
        if (bracketIndex >= 0)
        {
            root = root[..bracketIndex];
        }

        var dotIndex = root.IndexOf('.');
        if (dotIndex >= 0)
        {
            root = root[..dotIndex];
        }

        return root switch
        {
            "cropActivities" => "workDone",
            "irrigation" => "irrigation",
            "inputs" => "inputs",
            "labour" => "labour",
            "machinery" => "machinery",
            "activityExpenses" => "expenses",
            "plannedTasks" => "tasks",
            "observations" => "observations",
            _ => null
        };
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
