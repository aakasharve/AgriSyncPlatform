using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;

public sealed class GetScheduleTemplatesHandler(IShramSafalRepository repository)
{
    private static readonly IReadOnlyDictionary<string, int> StageOrderHints =
        new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
        {
            ["post pruning"] = 0,
            ["pruning"] = 0,
            ["planting"] = 0,
            ["sowing"] = 0,
            ["bahar treatment"] = 0,
            ["sprouting phase"] = 1,
            ["tillering"] = 1,
            ["pre-flowering"] = 2,
        };

    /// <summary>
    /// spec: plr-d10 lane L8b-1 fix round 1 (review H2) — <paramref name="callerUserId"/>'s library: the rows he may see,
    /// else the built-in catalog (<see cref="Services.ScheduleLibrary.ListingForAsync"/>). The reference route and the pull
    /// both answer it, and adoption reads exactly it. It used to be every row of every account, for everyone.
    /// </summary>
    public async Task<Result<IReadOnlyList<ScheduleTemplateDto>>> HandleAsync(Guid callerUserId, CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();

        var dbTemplates = await repository.GetScheduleTemplatesAsync(ct);
        return Result.Success(await Services.ScheduleLibrary.ListingForAsync(repository, dbTemplates, callerUserId, ct));
    }

    /// <summary>
    /// spec: plr-d10 lane L8b-1 — a library from the rows ONE caller may see (never all rows: see
    /// <see cref="Services.ScheduleLibrary.ListingForAsync"/>): the rows when there are any, else the built-in catalog.
    /// </summary>
    public static IReadOnlyList<ScheduleTemplateDto> Listing(
        IReadOnlyList<ScheduleTemplate> rows, IReadOnlyList<ScheduleCheck>? checks = null) =>
        rows.Count == 0 ? ReferenceDataCatalog.ScheduleTemplates : MapFromDb(rows, checks ?? []);

    public static IReadOnlyList<CropTypeDto> BuildCropTypes(IReadOnlyList<ScheduleTemplateDto> templates)
    {
        if (templates.Count == 0)
        {
            return ReferenceDataCatalog.CropTypes;
        }

        return templates
            .GroupBy(template => template.CropType, StringComparer.OrdinalIgnoreCase)
            .Select(group =>
            {
                var orderedTemplates = group
                    .OrderByDescending(template => template.Activities.Count)
                    .ThenBy(template => template.Name, StringComparer.OrdinalIgnoreCase)
                    .ToList();

                var stageNames = orderedTemplates
                    .SelectMany(template => template.Stages.Select(stage => stage.Name))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();

                return new CropTypeDto(
                    orderedTemplates[0].CropType,
                    stageNames,
                    orderedTemplates[0].Id);
            })
            .OrderBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static IReadOnlyList<ScheduleTemplateDto> MapFromDb(
        IReadOnlyList<ScheduleTemplate> templates, IReadOnlyList<ScheduleCheck> checks)
    {
        // spec: plr-d10 lane SCH-A (Task 1) - a row that STORES its days is listed exactly as stored (R3: no equal split,
        // no repeat guessed from the name); the guesses below stay for the other rows only (P11). The equal-split stage
        // list is worked out from the thin rows alone, so a stored row never changes what a thin row reads.
        var thin = templates.Where(template => !template.HasStoredDays).ToList();
        var stageDefinitionsByCrop = BuildStageDefinitionsByCrop(thin);
        var totalDaysByCrop = stageDefinitionsByCrop.ToDictionary(
            pair => pair.Key,
            pair => pair.Value.Count == 0 ? 60 : pair.Value.Max(stage => stage.EndDay) + 1,
            StringComparer.OrdinalIgnoreCase);
        var checksByRow = checks.GroupBy(c => c.ScheduleTemplateId).ToDictionary(g => g.Key, g => g.ToList());

        var mapped = templates
            .Select(template =>
            {
                var rowChecks = checksByRow.GetValueOrDefault(template.Id) ?? [];
                var check = ToCheckDto(template, rowChecks);
                var ownerType = template.OwnerType is { } owner ? ScheduleOwnerTypeWire.ToWire(owner) : null;
                var rowTag = $"v{template.Version}";

                if (template.HasStoredDays)
                {
                    return MapStored(template, check, ownerType, rowTag);
                }

                var cropType = DeriveCropType(template.Name);
                var stageDefinitions = stageDefinitionsByCrop.TryGetValue(cropType, out var stages)
                    ? stages
                    : [new StageDefinitionDto(template.Stage, 0, 59)];

                var activities = template.Activities
                    .OrderBy(activity => activity.OffsetDays)
                    .ThenBy(activity => activity.ActivityName, StringComparer.OrdinalIgnoreCase)
                    .Select(activity =>
                    {
                        var startDay = Math.Max(0, activity.OffsetDays);
                        var frequencyMode = DeriveFrequencyMode(activity.ActivityName);
                        var intervalDays = DeriveIntervalDays(frequencyMode, activity.ActivityName);

                        return new TemplateActivityDto(
                            activity.ActivityName,
                            DeriveCategory(activity.ActivityName),
                            template.Stage,
                            startDay,
                            startDay,
                            frequencyMode,
                            intervalDays);
                    })
                    .ToList();

                var totalDays = totalDaysByCrop.GetValueOrDefault(cropType, 60);

                return new ScheduleTemplateDto(
                    template.Id,
                    template.Name,
                    cropType,
                    totalDays,
                    stageDefinitions,
                    activities,
                    string.Empty,
                    OwnerType: ownerType,
                    SourceLabel: template.SourceLabel,
                    Check: check,
                    RowVersionTag: rowTag,
                    HasStoredDays: false);
            })
            .OrderBy(template => template.CropType, StringComparer.OrdinalIgnoreCase)
            .ThenBy(template => template.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var versionHash = ComputeDtoVersionHash(mapped);
        return mapped.Select(template => template with { VersionHash = versionHash }).ToList();
    }

    private static ScheduleTemplateDto MapStored(ScheduleTemplate template, ScheduleCheckDto check, string? ownerType, string rowTag)
    {
        var stages = template.Stages.Select(stage => new StageDefinitionDto(stage.Name, stage.StartDay, stage.EndDay)).ToList();
        var activities = template.Activities
            .OrderBy(activity => activity.OffsetDays)
            .ThenBy(activity => activity.ActivityName, StringComparer.OrdinalIgnoreCase)
            .Select(activity =>
            {
                var mode = activity.FrequencyMode;
                return new TemplateActivityDto(
                    activity.ActivityName,
                    StoredCategory(activity),
                    template.StageContaining(activity.OffsetDays)?.Name ?? template.Stage,
                    activity.OffsetDays,
                    activity.EndDay ?? activity.OffsetDays,
                    WireFrequency(mode),
                    mode == FrequencyMode.OneTime ? null : activity.IntervalDays,
                    OperationKey: activity.OperationKey,
                    Id: activity.Id,
                    Part: activity.Part,
                    Role: activity.Role,
                    NutrientKey: activity.NutrientKey,
                    AfterActivityId: activity.AfterActivityId,
                    StoredFrequencyMode: activity.StoredFrequencyMode is { } stored ? stored.ToString() : null);
            })
            .ToList();

        return new ScheduleTemplateDto(
            template.Id,
            template.Name,
            // S006: the same crop-type name the thin rows use (never the raw key), so the phone files it under a crop a plot has.
            Services.ScheduleLibrary.CropTypeNameFor(template.CropKey) ?? DeriveCropType(template.Name),
            stages.Count == 0 ? 0 : stages.Max(stage => stage.EndDay) + 1,
            stages,
            activities,
            string.Empty,
            OwnerType: ownerType,
            SourceLabel: template.SourceLabel,
            Check: check,
            RowVersionTag: rowTag,
            HasStoredDays: true);
    }

    private static string WireFrequency(FrequencyMode mode) => mode switch
    {
        FrequencyMode.EveryNDays => "every_n_days",
        FrequencyMode.PerWeek => "per_week",
        _ => "one_time",
    };

    // The category is a LABEL (the phone groups by it); for a stored row it follows the stored part, never the name.
    private static string StoredCategory(TemplateActivity activity) => activity.Part switch
    {
        "Spray" => "Spraying",
        "Irrigation" => "Irrigation",
        "Nutrition" => "Fertigation",
        _ => activity.OperationKey switch
        {
            "op_pruning" or "op_thinning" => "Pruning",
            "op_weed_man" => "Weeding",
            "op_harvest" => "Harvest",
            _ => DeriveCategory(activity.ActivityName),
        },
    };

    /// <summary>A row's state for the library: its LATEST decision, else NotChecked. Only a row that stores its days can carry one.</summary>
    private static ScheduleCheckDto ToCheckDto(ScheduleTemplate template, IReadOnlyList<ScheduleCheck> rowChecks)
    {
        var notChecked = new ScheduleCheckDto(nameof(ScheduleCheckState.NotChecked), null, null, null);
        if (!template.HasStoredDays)
        {
            return notChecked;
        }

        var latest = ScheduleCheck.Latest(rowChecks);
        return latest is null
            ? notChecked
            : new ScheduleCheckDto(
                ScheduleCheck.StateOf(rowChecks).ToString(), latest.CheckerDisplayName, latest.CheckedAtUtc, latest.Note);
    }

    private static Dictionary<string, IReadOnlyList<StageDefinitionDto>> BuildStageDefinitionsByCrop(
        IReadOnlyList<ScheduleTemplate> templates)
    {
        var result = new Dictionary<string, IReadOnlyList<StageDefinitionDto>>(StringComparer.OrdinalIgnoreCase);

        foreach (var group in templates.GroupBy(template => DeriveCropType(template.Name), StringComparer.OrdinalIgnoreCase))
        {
            var stages = group
                .Select(template => template.Stage)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(stage => GetStageOrder(stage))
                .ThenBy(stage => stage, StringComparer.OrdinalIgnoreCase)
                .ToList();

            var maxOffset = group
                .SelectMany(template => template.Activities)
                .Select(activity => Math.Max(0, activity.OffsetDays))
                .DefaultIfEmpty(0)
                .Max();

            var totalDays = Math.Max(60, maxOffset + 30);
            var stageCount = Math.Max(1, stages.Count);
            var stageSpan = Math.Max(10, (int)Math.Ceiling(totalDays / (decimal)stageCount));

            var definitions = new List<StageDefinitionDto>(stageCount);
            for (var index = 0; index < stageCount; index++)
            {
                var startDay = index * stageSpan;
                var endDay = index == stageCount - 1
                    ? totalDays - 1
                    : ((index + 1) * stageSpan) - 1;

                definitions.Add(new StageDefinitionDto(stages[index], startDay, endDay));
            }

            result[group.Key] = definitions;
        }

        return result;
    }

    private static int GetStageOrder(string stageName)
    {
        return StageOrderHints.TryGetValue(stageName.Trim(), out var rank) ? rank : 50;
    }

    private static string DeriveCropType(string templateName)
    {
        var parts = templateName.Split('-', 2, StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        return parts.Length > 0 ? parts[0] : templateName.Trim();
    }

    private static string DeriveCategory(string activityName)
    {
        var name = activityName.ToLowerInvariant();
        if (name.Contains("spray"))
        {
            return "Spraying";
        }

        if (name.Contains("irrigation") || name.Contains("drip") || name.Contains("flood") || name.Contains("water"))
        {
            return "Irrigation";
        }

        if (name.Contains("fertigation") || name.Contains("fertilizer") || name.Contains("nitrate") || name.Contains("urea") || name.Contains("dap") || name.Contains("fym"))
        {
            return "Fertigation";
        }

        if (name.Contains("pruning"))
        {
            return "Pruning";
        }

        if (name.Contains("weeding") || name.Contains("herbicide"))
        {
            return "Weeding";
        }

        if (name.Contains("sowing") || name.Contains("planting"))
        {
            return "Planting";
        }

        if (name.Contains("harvest"))
        {
            return "Harvest";
        }

        return "Monitoring";
    }

    private static string DeriveFrequencyMode(string activityName)
    {
        var name = activityName.ToLowerInvariant();
        if (name.Contains("irrigation") || name.Contains("spray") || name.Contains("fertigation") || name.Contains("inspection") || name.Contains("check"))
        {
            return "every_n_days";
        }

        return "one_time";
    }

    private static int? DeriveIntervalDays(string frequencyMode, string activityName)
    {
        if (!frequencyMode.Equals("every_n_days", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var name = activityName.ToLowerInvariant();
        if (name.Contains("irrigation"))
        {
            return 3;
        }

        if (name.Contains("spray"))
        {
            return 14;
        }

        if (name.Contains("fertigation"))
        {
            return 7;
        }

        return 7;
    }

    private static string ComputeDtoVersionHash(IReadOnlyList<ScheduleTemplateDto> templates)
    {
        var payload = templates.Select(template => new
        {
            template.Id,
            template.Name,
            template.CropType,
            template.TotalDays,
            Stages = template.Stages
                .Select(stage => new { stage.Name, stage.StartDay, stage.EndDay })
                .ToList(),
            Activities = template.Activities
                .Select(activity => new
                {
                    activity.Name,
                    activity.Category,
                    activity.StageName,
                    activity.StartDay,
                    activity.EndDay,
                    activity.FrequencyMode,
                    activity.IntervalDays
                })
                .ToList()
        });

        var json = JsonSerializer.Serialize(payload);

        // spec: plr-d10 lane SCH-A - a check (or a withdrawal) changes what the library says, so it changes the list hash;
        // a library with no decision hashes exactly as before the lane.
        var decided = templates
            .Where(template => template.Check is { State: not "NotChecked" })
            .Select(template => $"{template.Id:N}:{template.Check!.State}:{template.Check.CheckedAtUtc:O}")
            .ToList();
        if (decided.Count > 0)
        {
            json += "|" + string.Join(",", decided);
        }

        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(json));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}

public static class ReferenceDataCatalog
{
    private static readonly IReadOnlyList<TemplateSeed> TemplateSeeds = BuildTemplateSeeds();
    public static readonly string VersionHash = ComputeVersionHash(TemplateSeeds);

    public static readonly IReadOnlyList<ScheduleTemplateDto> ScheduleTemplates = TemplateSeeds
        .Select(seed => new ScheduleTemplateDto(
            seed.Id,
            seed.Name,
            seed.CropType,
            seed.TotalDays,
            seed.Stages.ToList(),
            seed.Activities
                .Select(activity => new TemplateActivityDto(
                    activity.Name,
                    activity.Category,
                    activity.StageName,
                    activity.StartDay,
                    activity.EndDay,
                    activity.FrequencyMode,
                    activity.IntervalDays))
                .ToList(),
            VersionHash))
        .ToList();

    public static readonly IReadOnlyList<CropTypeDto> CropTypes = ScheduleTemplates
        .GroupBy(template => template.CropType, StringComparer.OrdinalIgnoreCase)
        .Select(group =>
        {
            var primaryTemplate = group.First();
            var stages = primaryTemplate.Stages
                .Select(stage => stage.Name)
                .ToList();

            return new CropTypeDto(
                primaryTemplate.CropType,
                stages,
                primaryTemplate.Id);
        })
        .OrderBy(x => x.Name, StringComparer.OrdinalIgnoreCase)
        .ToList();

    public static readonly IReadOnlyList<string> ActivityCategories =
    [
        "Spraying",
        "Irrigation",
        "Fertigation",
        "Pruning",
        "Harvest",
        "Scouting",
        "Weeding",
        "Planting",
        "Monitoring"
    ];

    /// <summary>
    /// DATA_PRINCIPLE_SPINE sub-phase 02.5 — Conflict-Resolver R0 verdict.
    /// The canonical 13-code lookup is owned by <c>ssf.cost_categories</c>
    /// and projected via <see cref="IShramSafalRepository.GetCostCategoriesAsync"/>.
    /// This constant remains as a wire-compatible fallback (e.g. when the
    /// DB seed has not yet replayed) so the pull pipeline never returns
    /// an empty list. The labels match the seed.
    /// </summary>
    public static readonly IReadOnlyList<CostCategoryRefDto> CostCategories =
    [
        new("labour_payout",  "Labour payout",       "मजुरी (कामगार पेमेंट)",   "मज़दूरी (कामगार पेमेंट)"),
        new("labour_misc",    "Labour (misc)",       "इतर मजुरी",                "अन्य मज़दूरी"),
        new("seeds",          "Seeds",               "बियाणे",                   "बीज"),
        new("fertilizer",     "Fertilizer",          "खत",                       "उर्वरक"),
        new("pesticide",      "Pesticide",           "कीटकनाशक",                 "कीटनाशक"),
        new("irrigation",     "Irrigation",          "सिंचन",                    "सिंचाई"),
        new("machinery_rent", "Machinery rent",      "मशीन भाडे",                "मशीनरी किराया"),
        new("equipment",      "Equipment & repair",  "उपकरण व दुरुस्ती",         "उपकरण व मरम्मत"),
        new("fuel",           "Fuel (diesel/petrol)", "इंधन (डिझेल/पेट्रोल)",     "ईंधन (डीज़ल/पेट्रोल)"),
        new("transport",      "Transport",           "वाहतूक",                   "परिवहन"),
        new("electricity",    "Electricity",         "वीज",                      "बिजली"),
        new("packaging",      "Packaging",           "पॅकिंग",                   "पैकेजिंग"),
        new("other",          "Other",               "इतर",                      "अन्य"),
    ];

    private static string ComputeVersionHash(IReadOnlyList<TemplateSeed> templates)
    {
        var payload = templates.Select(template => new
        {
            template.Id,
            template.Name,
            template.CropType,
            template.TotalDays,
            Stages = template.Stages
                .Select(stage => new
                {
                    stage.Name,
                    stage.StartDay,
                    stage.EndDay
                })
                .ToList(),
            Activities = template.Activities
                .Select(activity => new
                {
                    activity.Name,
                    activity.Category,
                    activity.StageName,
                    activity.StartDay,
                    activity.EndDay,
                    activity.FrequencyMode,
                    activity.IntervalDays
                })
                .ToList()
        });

        var json = JsonSerializer.Serialize(payload);
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(json));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static IReadOnlyList<TemplateSeed> BuildTemplateSeeds()
    {
        var grapesStages = new[]
        {
            new StageDefinitionDto("Post Pruning", 0, 15),
            new StageDefinitionDto("Canopy Build", 16, 35),
            new StageDefinitionDto("Flowering & Fruit Set", 36, 60),
            new StageDefinitionDto("Berry Development", 61, 110),
            new StageDefinitionDto("Maturity & Harvest", 111, 150)
        };

        var pomegranateStages = new[]
        {
            new StageDefinitionDto("Bahar Treatment", 0, 30),
            new StageDefinitionDto("Vegetative Growth", 31, 75),
            new StageDefinitionDto("Fruit Development", 76, 135),
            new StageDefinitionDto("Maturity & Harvest", 136, 180)
        };

        var sugarcaneStages = new[]
        {
            new StageDefinitionDto("Germination", 0, 45),
            new StageDefinitionDto("Tillering", 46, 120),
            new StageDefinitionDto("Grand Growth", 121, 270),
            new StageDefinitionDto("Maturity", 271, 365)
        };

        var onionStages = new[]
        {
            new StageDefinitionDto("Transplant Establishment", 0, 20),
            new StageDefinitionDto("Bulb Initiation", 21, 50),
            new StageDefinitionDto("Bulb Development", 51, 90),
            new StageDefinitionDto("Maturity & Harvest", 91, 110)
        };

        return
        [
            new TemplateSeed(
                Guid.Parse("f3b8b9aa-0a53-4f7b-84a7-6ba6f1f77301"),
                "Grapes - Standard Seasonal Template",
                "Grapes",
                150,
                grapesStages,
                [
                    new TemplateActivitySeed("Pruning", "Pruning", "Post Pruning", 0, 1, "one_time", null),
                    new TemplateActivitySeed("Spraying", "Spraying", "Canopy Build", 18, 35, "every_n_days", 5),
                    new TemplateActivitySeed("Fertigation", "Fertigation", "Flowering & Fruit Set", 36, 60, "per_week", 2),
                    new TemplateActivitySeed("Irrigation", "Irrigation", "Berry Development", 61, 110, "every_n_days", 2),
                    new TemplateActivitySeed("Harvest", "Harvest", "Maturity & Harvest", 130, 150, "one_time", null)
                ]),
            new TemplateSeed(
                Guid.Parse("f3b8b9aa-0a53-4f7b-84a7-6ba6f1f77302"),
                "Pomegranate - Mrig Bahar Template",
                "Pomegranate",
                180,
                pomegranateStages,
                [
                    new TemplateActivitySeed("Bahar Treatment", "Pruning", "Bahar Treatment", 0, 5, "one_time", null),
                    new TemplateActivitySeed("Irrigation", "Irrigation", "Vegetative Growth", 31, 75, "every_n_days", 3),
                    new TemplateActivitySeed("Spraying", "Spraying", "Fruit Development", 80, 135, "every_n_days", 7),
                    new TemplateActivitySeed("Fertigation", "Fertigation", "Fruit Development", 90, 130, "per_week", 1),
                    new TemplateActivitySeed("Harvest", "Harvest", "Maturity & Harvest", 150, 180, "one_time", null)
                ]),
            new TemplateSeed(
                Guid.Parse("f3b8b9aa-0a53-4f7b-84a7-6ba6f1f77303"),
                "Sugarcane - Standard Annual Template",
                "Sugarcane",
                365,
                sugarcaneStages,
                [
                    new TemplateActivitySeed("Planting", "Planting", "Germination", 0, 7, "one_time", null),
                    new TemplateActivitySeed("Irrigation", "Irrigation", "Tillering", 46, 120, "every_n_days", 7),
                    new TemplateActivitySeed("Weeding", "Weeding", "Tillering", 60, 120, "every_n_days", 15),
                    new TemplateActivitySeed("Fertigation", "Fertigation", "Grand Growth", 121, 270, "per_week", 1),
                    new TemplateActivitySeed("Harvest", "Harvest", "Maturity", 320, 365, "one_time", null)
                ]),
            new TemplateSeed(
                Guid.Parse("f3b8b9aa-0a53-4f7b-84a7-6ba6f1f77304"),
                "Onion - Rabi Season Template",
                "Onion",
                110,
                onionStages,
                [
                    new TemplateActivitySeed("Transplanting", "Planting", "Transplant Establishment", 0, 2, "one_time", null),
                    new TemplateActivitySeed("Irrigation", "Irrigation", "Bulb Initiation", 21, 50, "every_n_days", 3),
                    new TemplateActivitySeed("Spraying", "Spraying", "Bulb Development", 51, 90, "per_week", 1),
                    new TemplateActivitySeed("Monitoring", "Monitoring", "Bulb Development", 51, 90, "every_n_days", 5),
                    new TemplateActivitySeed("Harvest", "Harvest", "Maturity & Harvest", 95, 110, "one_time", null)
                ])
        ];
    }

    private sealed record TemplateSeed(
        Guid Id,
        string Name,
        string CropType,
        int TotalDays,
        IReadOnlyList<StageDefinitionDto> Stages,
        IReadOnlyList<TemplateActivitySeed> Activities);

    private sealed record TemplateActivitySeed(
        string Name,
        string Category,
        string StageName,
        int StartDay,
        int EndDay,
        string FrequencyMode,
        int? IntervalDays);
}
