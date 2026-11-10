using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;

/// <summary>Who a library listing is for (see <see cref="GetScheduleTemplatesHandler.Listing"/>).</summary>
public enum ScheduleListingMode
{
    /// <summary>A farm caller: checked schedules, his own, and each crop's samples until that crop has a checked one.</summary>
    Farm = 0,

    /// <summary>A platform reviewer: every visible row with its state (the admin list). No built-in samples beside rows.</summary>
    Reviewer = 1,

    /// <summary>Adoption's lookup: every visible row and every sample, whether or not listed; the check rule decides.</summary>
    Pool = 2,
}

public sealed class GetScheduleTemplatesHandler(IShramSafalRepository repository, ShramSafal.Application.Admin.Ports.IEntitlementResolver? entitlements = null)
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
        return Result.Success(await Services.ScheduleLibrary.ListingForAsync(
            repository, dbTemplates, callerUserId, ct, entitlements));
    }

    /// <summary>
    /// spec: plr-d10 lane L8b-1F (R7, P10) - the PULL's library: <see cref="HandleAsync(Guid, CancellationToken)"/> plus the
    /// schedules this person's plots ALREADY follow that the listing no longer offers for a new choice (a sample, once its crop has
    /// a checked schedule; a withdrawn one). A plot that follows one keeps it, so its phone must still be able to read it; the phone's
    /// library never offers such a schedule for a new choice (it applies the same per-crop rule). The list hash then also covers
    /// the added ids, so a phone told the library changed gets the new list.
    /// </summary>
    public async Task<Result<IReadOnlyList<ScheduleTemplateDto>>> HandleAsync(
        Guid callerUserId, IReadOnlyCollection<Guid> followedTemplateIds, CancellationToken ct = default)
    {
        var listed = await HandleAsync(callerUserId, ct);
        if (!listed.IsSuccess || followedTemplateIds.Count == 0)
        {
            return listed;
        }

        var have = (listed.Value ?? []).Select(t => t.Id).ToHashSet();
        var missing = followedTemplateIds.Where(id => !have.Contains(id)).Distinct().OrderBy(id => id).ToList();
        if (missing.Count == 0)
        {
            return listed;
        }

        // spec: plr-d10 lane SCH-OWN-c (F222 (a); R-c9) - the followed extras are NOT filtered by the viewer: the ids are the reader's own plots' facts, so a
        // version row a plot of his follows reaches him whoever owns it now (after a transfer of the farm, the new owner's seats keep receiving it).
        var allRows = await repository.GetScheduleTemplatesAsync(ct);
        var extras = await Services.ScheduleLibrary.FollowedAsync(repository, allRows, callerUserId, missing, ct);
        if (extras.Count == 0)
        {
            return listed;
        }

        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            (listed.Value![0].VersionHash ?? string.Empty) + "|followed:" + string.Join(",", extras.Select(e => $"{e.Id:N}:{e.Check?.State}"))))).ToLowerInvariant();
        IReadOnlyList<ScheduleTemplateDto> all = (listed.Value ?? [])
            .Concat(extras)
            .OrderBy(t => t.CropType, StringComparer.OrdinalIgnoreCase)
            .ThenBy(t => t.Name, StringComparer.OrdinalIgnoreCase)
            .Select(t => t with { VersionHash = hash })
            .ToList();
        return Result.Success(all);
    }

    /// <summary>
    /// spec: plr-d10 lane L8b-1F (register F114; founder D-91 = 1, D-82 = 3) - a library from the rows ONE caller may see (never all
    /// rows: see <see cref="Services.ScheduleLibrary.ListingForAsync"/>): <b>his visible rows PLUS the samples, by crop</b>.
    /// <list type="bullet">
    /// <item>His own rows (every row that is not Public: his Private ones, his team's, the farm's own) are always listed and never
    /// hide a sample.</item>
    /// <item>A <b>sample</b> is a built-in seed or a Public row that stores no days (the thin rows from before SCH-A). Its crop is
    /// the <see cref="ScheduleTemplateDto.CropType"/> (<see cref="Services.ScheduleLibrary.CropGroupKey"/>, case-blind). A crop's
    /// samples are listed, each with <c>Check.State = NotChecked</c>, ONLY while that crop has no Checked Outside row; once it
    /// has one, that crop's samples drop and every other crop's stay.</item>
    /// <item>A Public row that stores its days is Outside: a farm caller sees it only once it is Checked (or Withdrawn, so a plot that
    /// follows it can say why; never offered for a new choice). One still waiting for its check, or sent back, is never listed to a
    /// farm caller (D-82 note).</item>
    /// </list>
    /// <paramref name="checks"/> are the latest decisions of the rows that store their days (SCH-A's shape, kept). The mode says who
    /// is asking: <see cref="ScheduleListingMode.Farm"/> (the default), a platform <see cref="ScheduleListingMode.Reviewer"/> (every
    /// row with its state, for the admin list), or the adoption <see cref="ScheduleListingMode.Pool"/> (every row and every sample
    /// he could ever be offered; the check rule then decides). Pure and static.
    /// </summary>
    public static IReadOnlyList<ScheduleTemplateDto> Listing(
        IReadOnlyList<ScheduleTemplate> rows,
        IReadOnlyList<ScheduleCheck>? checks = null,
        ScheduleListingMode mode = ScheduleListingMode.Farm)
    {
        ArgumentNullException.ThrowIfNull(rows);
        var samples = SamplesOf(ReferenceDataCatalog.ScheduleTemplates);
        if (rows.Count == 0)
        {
            // Nothing of his to list: the built-in samples, as before the lane (their hash stays the catalog's).
            return samples;
        }

        var mapped = MapFromDb(rows, checks ?? []);
        var rowById = rows.GroupBy(r => r.Id).ToDictionary(g => g.Key, g => g.First());
        var all = mapped.Where(d => rowById.ContainsKey(d.Id)).ToList();

        // Crops that already have a Checked Outside schedule: their samples are no longer offered for a new choice.
        var checkedCrops = CheckedOutsideCrops(all, rowById);

        bool Listed(ScheduleTemplateDto d, ScheduleTemplate? row, bool isSample)
        {
            if (mode == ScheduleListingMode.Pool)
            {
                return true;
            }

            if (row is { } r && !IsOutsideRow(r))
            {
                return true;
            }

            if (isSample)
            {
                return mode == ScheduleListingMode.Reviewer || !checkedCrops.Contains(Services.ScheduleLibrary.CropGroupKey(d.CropType));
            }

            var state = d.Check?.State;
            return mode == ScheduleListingMode.Reviewer
                || state == nameof(ScheduleCheckState.Checked)
                || state == nameof(ScheduleCheckState.Withdrawn);
        }

        var listed = new List<ScheduleTemplateDto>();
        foreach (var d in all)
        {
            var row = rowById[d.Id];
            var isSample = IsOutsideRow(row) && !row.HasStoredDays;
            if (Listed(d, row, isSample))
            {
                listed.Add(isSample ? WithCheck(d, ScheduleCheckState.NotChecked) : d);
            }
        }

        if (mode != ScheduleListingMode.Reviewer)
        {
            foreach (var sample in samples)
            {
                if (!rowById.ContainsKey(sample.Id) && Listed(sample, null, isSample: true))
                {
                    listed.Add(sample);
                }
            }
        }

        var ordered = listed
            .OrderBy(template => template.CropType, StringComparer.OrdinalIgnoreCase)
            .ThenBy(template => template.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        var versionHash = ComputeDtoVersionHash(ordered);
        return ordered.Select(template => template with { VersionHash = versionHash }).ToList();
    }

    /// <summary>
    /// The ONE rule for "this crop has a Checked Outside schedule" (the listing's per-crop sample rule and adopt's bridge both read it):
    /// the crop groups (<see cref="Services.ScheduleLibrary.CropGroupKey"/>) of the listed dtos whose row is Outside and whose state is Checked.
    /// </summary>
    internal static HashSet<string> CheckedOutsideCrops(
        IEnumerable<ScheduleTemplateDto> dtos, IReadOnlyDictionary<Guid, ScheduleTemplate> rowById) =>
        dtos
            .Where(d => rowById.TryGetValue(d.Id, out var row) && IsOutsideRow(row) && d.Check?.State == nameof(ScheduleCheckState.Checked))
            .Select(d => Services.ScheduleLibrary.CropGroupKey(d.CropType))
            .ToHashSet(StringComparer.Ordinal);

    /// <summary>A row the check applies to: Public (only a Public row can be checked, SCH-A).</summary>
    internal static bool IsOutsideRow(ScheduleTemplate row) => row.TenantScope == TenantScope.Public;

    private static ScheduleTemplateDto WithCheck(ScheduleTemplateDto dto, ScheduleCheckState state) =>
        dto with { Check = new ScheduleCheckDto(state.ToString(), null, null, null) };

    private static IReadOnlyList<ScheduleTemplateDto> SamplesOf(IReadOnlyList<ScheduleTemplateDto> builtIns) =>
        builtIns.Select(b => WithCheck(b, ScheduleCheckState.NotChecked)).ToList();

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
                    DefaultTemplateIdOf(group));
            })
            .OrderBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>
    /// spec: plr-d10 lane SCH-OWN carry-in F207 (D-91 = 1, P4, P5) - the crop's DEFAULT schedule, the one rule the phone reads as
    /// <c>followableDefault.ts</c> (<c>defaultScheduleForCrop</c>): chosen from the OUTSIDE rows of the listing only (a built-in sample,
    /// which carries no scope, or a Public row) - never the farm's own (Team) rows and never another scope's.
    /// <list type="number">
    /// <item>an outside schedule ShramSafal has CHECKED: the Institution one first (R6), else the first in the listing's order;</item>
    /// <item>else the first <b>sample</b> (not checked and not storing its days) - offered only on a crop with no checked schedule;</item>
    /// <item>else <c>null</c>: nothing followable, and the phone invents no stand-in (P4).</item>
    /// </list>
    /// It used to be the template with the MOST activities, which could be an unchecked sample the phone never offers, or a row of the farm's own.
    /// A withdrawn, sent-back or waiting outside schedule is neither checked nor a sample (a waiting row stores its days), so it is never the default.
    /// </summary>
    private static Guid? DefaultTemplateIdOf(IEnumerable<ScheduleTemplateDto> cropTemplates)
    {
        var outside = cropTemplates
            .Where(t => t.Scope is null || string.Equals(t.Scope, nameof(TenantScope.Public), StringComparison.Ordinal))
            .ToList();
        var checkedRows = outside.Where(t => t.Check?.State == nameof(ScheduleCheckState.Checked)).ToList();
        if (checkedRows.Count > 0)
        {
            return (checkedRows.FirstOrDefault(t => string.Equals(t.OwnerType, "INSTITUTION", StringComparison.Ordinal)) ?? checkedRows[0]).Id;
        }

        return outside
            .FirstOrDefault(t => (t.Check is null || t.Check.State == nameof(ScheduleCheckState.NotChecked)) && t.HasStoredDays != true)
            ?.Id;
    }

    private static IReadOnlyList<ScheduleTemplateDto> MapFromDb(
        IReadOnlyList<ScheduleTemplate> templates, IReadOnlyList<ScheduleCheck> checks)
    {
        // spec: plr-d10 lane SCH-A (Task 1) - a row that STORES its days is listed exactly as stored (R3: no equal split,
        // no repeat guessed from the name); the guesses below stay for the other rows only (P11). The equal-split stage
        // list is worked out from the thin rows alone, so a stored row never changes what a thin row reads.
        // spec: plr-d10 lane SCH-OWN (D6) - a person's own schedule that stores no days (made empty) is NOT a thin row: it feeds no equal-split stage
        // list (that would invent stages for it and for every other row of its crop, P4), and 1.0.17 drops stage-less templates it cannot place.
        var thin = templates.Where(template => !template.HasStoredDays && template.OwnerUserId is null).ToList();
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
                // spec: plr-d10 lane SCH-OWN (D-82 = 3) - no check applies to a farm's own schedule: its entry carries none (never "not checked yet").
                var check = template.OwnerUserId is null ? ToCheckDto(template, rowChecks) : null;
                var ownerType = template.OwnerType is { } owner ? ScheduleOwnerTypeWire.ToWire(owner) : null;
                var rowTag = $"v{template.Version}";

                if (template.HasStoredDays)
                {
                    return WithProvenance(MapStored(template, check, ownerType, rowTag), template);
                }

                // D6: a row that names its crop (SCH-OWN) is listed under that crop's name - never one read from its title.
                var cropType = Services.ScheduleLibrary.CropTypeNameFor(template.CropKey) ?? DeriveCropType(template.Name);
                var emptyOwn = template.OwnerUserId is not null;
                IReadOnlyList<StageDefinitionDto> stageDefinitions = emptyOwn
                    ? []
                    : stageDefinitionsByCrop.TryGetValue(cropType, out var stages)
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

                var totalDays = emptyOwn ? 0 : totalDaysByCrop.GetValueOrDefault(cropType, 60);

                // M004 ruling (SCH-OWN-c, R-c10; P11): an own version with stages but no works still lists Stages [] and TotalDays 0 - release 1.0.17 lists
                // any template with a stage and treats OwnScheduleEmpty (unknown to it) as retryable, so a stages-only entry would make it churn to the
                // retry cap on adopt. The stored stages reach NEW phones through DraftStages (WithProvenance).
                return WithProvenance(
                    new ScheduleTemplateDto(
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
                        HasStoredDays: false,
                        Scope: template.TenantScope.ToString()),
                    template);
            })
            .OrderBy(template => template.CropType, StringComparer.OrdinalIgnoreCase)
            .ThenBy(template => template.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return mapped;
    }

    /// <summary>
    /// spec: plr-d10 lane SCH-OWN-c (founder D-137; F222; R-c11) - the additive, optional provenance of a DB row (P11: at the END of the DTO, null
    /// elsewhere): whose own schedule it is (<c>owner_user_id</c>, the PERSON), who typed THIS version, when, and the version before - on every row
    /// that is not Public (a Public import's maker is ShramSafal staff: least exposure); the four made-for tags on any row that carries them; and
    /// <c>DraftStages</c>, the stored stages of a version that has stages but no works yet (its <c>Stages</c> stays [] for 1.0.17, M004).
    /// </summary>
    private static ScheduleTemplateDto WithProvenance(ScheduleTemplateDto dto, ScheduleTemplate template)
    {
        var isPublic = template.TenantScope == TenantScope.Public;
        return dto with
        {
            OwnerUserId = isPublic ? null : template.OwnerUserId?.Value,
            MadeByUserId = isPublic ? null : template.CreatedByUserId?.Value,
            MadeAtUtc = isPublic ? null : template.CreatedAtUtc,
            PreviousVersionId = isPublic ? null : template.PreviousVersionId,
            Variety = template.Variety,
            SoilType = template.SoilType,
            Region = template.Region,
            Climate = template.Climate,
            DraftStages = template.StageRows.Count > 0 && !template.HasStoredDays
                ? template.Stages.Select(stage => new StageDefinitionDto(stage.Name, stage.StartDay, stage.EndDay)).ToList()
                : null,
        };
    }

    private static ScheduleTemplateDto MapStored(ScheduleTemplate template, ScheduleCheckDto? check, string? ownerType, string rowTag)
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
            HasStoredDays: true,
            Scope: template.TenantScope.ToString());
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

        // spec: plr-d10 lane SCH-OWN-c (R-c12) - a made-for tag is CONTENT: a tag change is a library change the phone must fetch. Appended only when a
        // row carries a tag, so a library with no tag hashes exactly as before the lane (no needless refetch on every phone); owner and maker are not
        // content and do not hash.
        var tagged = templates
            .Where(template => template.Variety is not null || template.SoilType is not null || template.Region is not null || template.Climate is not null)
            .Select(template => $"{template.Id:N}:{template.Variety}|{template.SoilType}|{template.Region}|{template.Climate}")
            .ToList();
        if (tagged.Count > 0)
        {
            json += "|madeFor:" + string.Join(",", tagged);
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
