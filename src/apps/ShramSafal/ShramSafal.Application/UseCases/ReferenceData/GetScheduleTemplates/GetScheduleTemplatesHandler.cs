using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;

namespace ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;

public sealed class GetScheduleTemplatesHandler
{
    public Task<Result<IReadOnlyList<ScheduleTemplateDto>>> HandleAsync(CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(Result.Success<IReadOnlyList<ScheduleTemplateDto>>(ReferenceDataCatalog.ScheduleTemplates));
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

    public static readonly IReadOnlyList<string> CostCategories =
    [
        "Labour",
        "Seeds",
        "Fertilizer",
        "Pesticide",
        "Equipment",
        "Fuel",
        "Water",
        "Transport",
        "Miscellaneous"
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
