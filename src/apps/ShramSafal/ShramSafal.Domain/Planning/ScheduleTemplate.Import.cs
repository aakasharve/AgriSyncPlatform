using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Compare;

namespace ShramSafal.Domain.Planning;

/// <summary>One activity of an imported schedule, as the platform reviewer loads it (spec: plr-d10 lane SCH-A Task 4).</summary>
/// <param name="Key">A request-local name for the activity; only <paramref name="AfterKey"/> refers to it.</param>
/// <param name="AfterKey">R34: the <c>Key</c> of the once-only work of the same request this one comes after.</param>
/// <param name="Role">An optional role the reviewer states; otherwise WORK-ID proposes it from the title.</param>
public sealed record ImportedActivity(
    string? Key,
    string Name,
    int StartDay,
    int EndDay,
    FrequencyMode Mode,
    int IntervalDays,
    string? AfterKey = null,
    string? Role = null);

/// <summary>A refused import: a stable code, and the words that say why (English for the staff console).</summary>
public sealed record ScheduleImportProblem(string Code, string Message);

public sealed partial class ScheduleTemplate
{
    public static readonly IReadOnlyList<string> Roles = ["fungicide", "insecticide", "herbicide", "pgr", "nutrient"];

    public const int MaxNameLength = 120;
    public const int MaxStageNameLength = 80;
    public const int MaxSourceLabelLength = 160;
    public const int MaxCropKeyLength = 60;

    // spec: plr-d10 lane SCH-OWN fix round 1 (M002) - the sync contract's bounds for a farm's own edit (schedule_edit.zod.ts), enforced by the server too.
    public const int MaxEditStages = 40;
    public const int MaxEditActivities = 300;
    public const int MaxEditDay = 3650;

    /// <summary>The widest an operation key may be: the width of <c>template_activities.operation_key</c> (the column is not widened).</summary>
    public const int MaxOperationKeyLength = 40;

    /// <summary>
    /// Builds a schedule that STORES all its days (spec: plr-d10 lane SCH-A Task 4). Refused, with words: an end before its
    /// start; an activity outside every stage; an order (R34) that points outside the row, is not between two
    /// <see cref="FrequencyMode.OneTime"/> works, or loops. The server mints every id. Part, OperationKey, Role and
    /// NutrientKey are PROPOSED here by <see cref="WorkRecogniser"/> (D-104a; W003: the operation keys are WORK-ID's, never
    /// coined here) and stored; the checker ticks them with the row.
    /// </summary>
    public static ScheduleTemplate? Import(
        Guid id,
        string name,
        ScheduleOwnerType ownerType,
        string? sourceLabel,
        string? cropKey,
        UserId makerUserId,
        TenantScope scope,
        DateTime createdAtUtc,
        IReadOnlyList<StageDefinition> stages,
        IReadOnlyList<ImportedActivity> activities,
        out ScheduleImportProblem? problem)
    {
        problem = null;
        if (string.IsNullOrWhiteSpace(name) || name.Trim().Length > MaxNameLength)
        {
            problem = new("ScheduleImportName", $"The schedule needs a name of at most {MaxNameLength} characters.");
            return null;
        }

        if (sourceLabel is { } label && label.Trim().Length > MaxSourceLabelLength)
        {
            problem = new("ScheduleImportSource", $"The source label may be at most {MaxSourceLabelLength} characters.");
            return null;
        }

        if (cropKey is { } crop && crop.Trim().Length > MaxCropKeyLength)
        {
            problem = new("ScheduleImportCrop", $"The crop key may be at most {MaxCropKeyLength} characters.");
            return null;
        }

        problem = CheckStages(stages);
        if (problem is not null)
        {
            return null;
        }

        if (activities is null || activities.Count == 0)
        {
            problem = new("ScheduleImportActivities", "A schedule needs at least one activity.");
            return null;
        }

        var orderedStages = stages
            .Select(s => new StageDefinition(s.Name.Trim(), s.StartDay, s.EndDay))
            .OrderBy(s => s.StartDay).ThenBy(s => s.EndDay).ToList();
        var lastDay = orderedStages.Max(s => s.EndDay);

        var byKey = new Dictionary<string, ImportedActivity>(StringComparer.Ordinal);
        foreach (var a in activities)
        {
            problem = CheckActivityDays(a.Name, a.StartDay, a.EndDay, a.Mode, a.IntervalDays, orderedStages, lastDay);
            if (problem is not null)
            {
                return null;
            }

            if (a.Role is { } r && !string.IsNullOrWhiteSpace(r) && !Roles.Contains(r.Trim().ToLowerInvariant()))
            {
                problem = new("ScheduleImportRole", $"\"{a.Name.Trim()}\": the role \"{r}\" is not one of {string.Join(", ", Roles)}.");
                return null;
            }

            if (!string.IsNullOrWhiteSpace(a.Key) && !byKey.TryAdd(a.Key.Trim(), a))
            {
                problem = new("ScheduleImportKey", $"The key \"{a.Key.Trim()}\" is used by two activities.");
                return null;
            }
        }

        // R34 - the order. An 'after' names a OneTime work of the same request, from a OneTime work, and never loops.
        foreach (var a in activities.Where(x => !string.IsNullOrWhiteSpace(x.AfterKey)))
        {
            var afterKey = a.AfterKey!.Trim();
            if (!byKey.TryGetValue(afterKey, out var target) || ReferenceEquals(target, a))
            {
                problem = new("ScheduleImportOrder", $"\"{a.Name.Trim()}\" comes after \"{afterKey}\", which is not another activity of this schedule.");
                return null;
            }

            if (a.Mode != FrequencyMode.OneTime || target.Mode != FrequencyMode.OneTime)
            {
                problem = new("ScheduleImportOrder", $"\"{a.Name.Trim()}\" comes after \"{target.Name.Trim()}\": an order may only join two once-only works, never a repeated one.");
                return null;
            }

            if (string.IsNullOrWhiteSpace(a.Key))
            {
                problem = new("ScheduleImportOrder", $"\"{a.Name.Trim()}\" has an order but no key.");
                return null;
            }
        }

        foreach (var a in activities.Where(x => !string.IsNullOrWhiteSpace(x.AfterKey)))
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            var current = a;
            while (current is not null && !string.IsNullOrWhiteSpace(current.AfterKey))
            {
                if (!seen.Add(current.Key!.Trim()))
                {
                    problem = new("ScheduleImportOrder", $"The order around \"{a.Name.Trim()}\" loops back on itself.");
                    return null;
                }

                current = byKey.GetValueOrDefault(current.AfterKey!.Trim());
            }
        }

        var template = new ScheduleTemplate(
            id, name.Trim(), orderedStages[0].Name, createdAtUtc, makerUserId, scope,
            version: 1, previousVersionId: null, derivedFromTemplateId: null, orderedStages)
        {
            OwnerType = ownerType,
            SourceLabel = string.IsNullOrWhiteSpace(sourceLabel) ? null : sourceLabel.Trim(),
            CropKey = string.IsNullOrWhiteSpace(cropKey) ? null : cropKey.Trim(),
        };

        // Mint the ids first so an 'after' can name one.
        var idByKey = new Dictionary<string, Guid>(StringComparer.Ordinal);
        var minted = new List<(ImportedActivity Source, Guid Id)>();
        foreach (var a in activities)
        {
            var activityId = Guid.NewGuid();
            minted.Add((a, activityId));
            if (!string.IsNullOrWhiteSpace(a.Key))
            {
                idByKey[a.Key.Trim()] = activityId;
            }
        }

        foreach (var (a, activityId) in minted)
        {
            var identity = WorkRecogniser.Recognise(a.Name.Trim());
            var part = (identity?.Part ?? WorkPart.Work).ToString();
            var role = string.IsNullOrWhiteSpace(a.Role) ? identity?.Role : a.Role.Trim().ToLowerInvariant();
            var nutrientKey = role == "nutrient" ? identity?.NutrientKey : null;
            Guid? after = string.IsNullOrWhiteSpace(a.AfterKey) ? null : idByKey[a.AfterKey.Trim()];

            template._activities.Add(TemplateActivity.Stored(
                activityId, id, a.Name.Trim(), a.StartDay, a.EndDay, a.Mode,
                a.Mode == FrequencyMode.OneTime ? 1 : a.IntervalDays,
                part, identity?.OperationKey, role, nutrientKey, after));
        }

        return template;
    }

    /// <summary>
    /// Fix round 1 (M002) - the bounds of a farm's own edit that the sync contract states and the database or the phone's list cannot hold.
    /// Counts first, then the day numbers (stage, activity, repeat). Codes are import's own.
    /// </summary>
    private static ScheduleImportProblem? CheckEditBounds(IReadOnlyList<StageDefinition> stages, IReadOnlyList<ScheduleActivityDraft>? activities)
    {
        if (stages.Count > MaxEditStages)
        {
            return new("ScheduleImportStages", $"A schedule may have at most {MaxEditStages} stages.");
        }

        if (activities is not null && activities.Count > MaxEditActivities)
        {
            return new("ScheduleImportActivities", $"A schedule may have at most {MaxEditActivities} activities.");
        }

        foreach (var stage in stages)
        {
            if (stage.StartDay > MaxEditDay || stage.EndDay > MaxEditDay)
            {
                return new("ScheduleImportStageDays", $"Stage \"{stage.Name.Trim()}\": a day may be at most {MaxEditDay}.");
            }
        }

        foreach (var a in activities ?? [])
        {
            if (a.StartDay > MaxEditDay || a.EndDay > MaxEditDay)
            {
                return new("ScheduleImportActivityDays", $"\"{a.Name?.Trim()}\": a day may be at most {MaxEditDay}.");
            }

            if (a.IntervalDays > MaxEditDay)
            {
                return new("ScheduleImportRepeat", $"\"{a.Name?.Trim()}\": the repeat may be at most {MaxEditDay}.");
            }
        }

        return null;
    }

    /// <summary>
    /// Fix round 1 (M002) - a phone-supplied operation key: absent is fine (WORK-ID proposes it); a given one must be a work key's SHAPE
    /// (<c>op_</c> + lower-case letters, digits and underscores) and fit the column (at most <see cref="MaxOperationKeyLength"/>); an empty or
    /// blank one is refused, never stored. The shape is checked, not the vocabulary: the phone's own keys (<c>op_local</c>, <c>op_unknown</c>,
    /// <c>op_harvest_plan</c>, ...) are wider than WORK-ID's list, and refusing them would refuse the phone's own writes.
    /// </summary>
    private static ScheduleImportProblem? CheckOperationKey(ScheduleActivityDraft a)
    {
        if (a.OperationKey is null)
        {
            return null;
        }

        var key = a.OperationKey.Trim();
        var shaped = key.Length is > 3 and <= MaxOperationKeyLength
            && key.StartsWith("op_", StringComparison.Ordinal)
            && key.All(c => c is (>= 'a' and <= 'z') or (>= '0' and <= '9') or '_');
        return shaped
            ? null
            : new("ScheduleImportOperationKey", $"\"{a.Name?.Trim()}\": the operation key must be like op_pruning (lower case, at most {MaxOperationKeyLength} characters).");
    }

    /// <summary>
    /// spec: plr-d10 lane SCH-OWN (D9) - the stage rules of <see cref="Import"/>, one place, shared with a farm's own edit
    /// (<see cref="EditCopyOnWrite(Guid, string?, string?, IReadOnlyList{StageDefinition}, IReadOnlyList{ScheduleActivityDraft}, UserId, DateTime, out ScheduleImportProblem?)"/>):
    /// at least one stage; every stage named (at most 80) and not ending before it starts.
    /// </summary>
    private static ScheduleImportProblem? CheckStages(IReadOnlyList<StageDefinition>? stages)
    {
        if (stages is null || stages.Count == 0)
        {
            return new("ScheduleImportStages", "A schedule needs at least one stage.");
        }

        foreach (var stage in stages)
        {
            if (string.IsNullOrWhiteSpace(stage.Name) || stage.Name.Trim().Length > MaxStageNameLength)
            {
                return new("ScheduleImportStages", $"Every stage needs a name of at most {MaxStageNameLength} characters.");
            }

            if (stage.StartDay < 0 || stage.EndDay < stage.StartDay)
            {
                return new("ScheduleImportStageDays", $"Stage \"{stage.Name.Trim()}\": the end day ({stage.EndDay}) is before the start day ({stage.StartDay}).");
            }
        }

        return null;
    }

    /// <summary>
    /// spec: plr-d10 lane SCH-OWN (D9) - the day rules of <see cref="Import"/> for ONE activity, in the order import has always checked
    /// them (name, days, inside a stage, repeat), shared with a farm's own edit. <paramref name="orderedStages"/> are the stages by day.
    /// </summary>
    private static ScheduleImportProblem? CheckActivityDays(
        string? name, int startDay, int endDay, FrequencyMode mode, int intervalDays,
        IReadOnlyList<StageDefinition> orderedStages, int lastDay)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Trim().Length > MaxNameLength)
        {
            return new("ScheduleImportActivityName", $"Every activity needs a name of at most {MaxNameLength} characters.");
        }

        if (startDay < 0 || endDay < startDay)
        {
            return new("ScheduleImportActivityDays", $"\"{name.Trim()}\": the end day ({endDay}) is before the start day ({startDay}).");
        }

        if (!orderedStages.Any(s => s.StartDay <= startDay && startDay <= s.EndDay) || endDay > lastDay)
        {
            return new("ScheduleImportOutsideStages", $"\"{name.Trim()}\" (days {startDay}-{endDay}) is outside every stage.");
        }

        var intervalOk = mode switch
        {
            FrequencyMode.OneTime => intervalDays >= 1,
            FrequencyMode.EveryNDays => intervalDays >= 1,
            FrequencyMode.PerWeek => intervalDays is >= 1 and <= 7,
            _ => false,
        };
        return intervalOk
            ? null
            : new("ScheduleImportRepeat", $"\"{name.Trim()}\": the repeat is not valid (every N days needs N of 1 or more; per week needs 1 to 7).");
    }
}
