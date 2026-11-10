using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Events;

namespace ShramSafal.Domain.Planning;

public sealed partial class ScheduleTemplate : Entity<Guid>
{
    private readonly List<TemplateActivity> _activities = [];
    private readonly List<ScheduleTemplateStage> _stages = [];

    private ScheduleTemplate() : base(Guid.Empty) { } // EF Core

    private ScheduleTemplate(
        Guid id,
        string name,
        string stage,
        DateTime createdAtUtc,
        UserId? createdByUserId,
        TenantScope tenantScope,
        int version,
        Guid? previousVersionId,
        Guid? derivedFromTemplateId,
        IEnumerable<StageDefinition>? stages = null)
        : base(id)
    {
        Name = name;
        Stage = stage;
        CreatedAtUtc = createdAtUtc;
        CreatedByUserId = createdByUserId;
        TenantScope = tenantScope;
        Version = version;
        PreviousVersionId = previousVersionId;
        DerivedFromTemplateId = derivedFromTemplateId;
        if (stages is not null)
        {
            var ordered = stages
                .Where(s => !string.IsNullOrWhiteSpace(s.Name))
                .OrderBy(s => s.StartDay)
                .ThenBy(s => s.EndDay)
                .ToList();
            for (var i = 0; i < ordered.Count; i++)
            {
                _stages.Add(new ScheduleTemplateStage(Guid.NewGuid(), id, i, ordered[i].Name, ordered[i].StartDay, ordered[i].EndDay));
            }
        }
    }

    public string Name { get; private set; } = string.Empty;
    public string Stage { get; private set; } = string.Empty;
    public DateTime CreatedAtUtc { get; private set; }
    public IReadOnlyCollection<TemplateActivity> Activities => _activities.AsReadOnly();

    /// <summary>The stages in order (<c>ssf.schedule_template_stages</c>; empty on a row made before the lane).</summary>
    public IReadOnlyCollection<StageDefinition> Stages =>
        _stages.OrderBy(s => s.OrderIndex).Select(s => s.ToDefinition()).ToList();

    /// <summary>The stored stage rows (for the persistence map).</summary>
    public IReadOnlyCollection<ScheduleTemplateStage> StageRows => _stages.AsReadOnly();

    // New fields — CEI Phase 1
    public UserId? CreatedByUserId { get; private set; }
    public TenantScope TenantScope { get; private set; } = TenantScope.Public;
    public int Version { get; private set; } = 1;
    public Guid? PreviousVersionId { get; private set; }
    public Guid? DerivedFromTemplateId { get; private set; }
    public DateTime? PublishedAtUtc { get; private set; }

    /// <summary>
    /// spec: plr-d10 lane SCH-OWN (founder D-74, D-82 = 3; register R30) - the farm this schedule is the OWN schedule of, for every
    /// version of its chain; null = not a farm's own schedule (every row made before the lane). Plain data, no foreign-key
    /// navigation: it is a farm id, not an owner (R30: a farm's own schedule belongs to the FARM, whoever owns it).
    /// </summary>
    public Guid? OwnFarmId { get; private set; }

    // spec: plr-d10 lane SCH-A (Task 1) — who the schedule comes from (the phone's own owner types), the source as written,
    // and the crop it is for. All null on a row made before the lane.
    public ScheduleOwnerType? OwnerType { get; private set; }
    public string? SourceLabel { get; private set; }
    public string? CropKey { get; private set; }

    /// <summary>
    /// R3 / P4: true only when the row STORES its days — at least one stage, every stage with days, and at least one
    /// activity, every activity with part, start, end and repeat. Only such a row can be checked; the library invents the
    /// days of any other row and a row it invents never carries ShramSafal's name.
    /// </summary>
    public bool HasStoredDays =>
        _stages.Count > 0
        && _activities.Count > 0
        && _stages.All(s => s.StartDay <= s.EndDay)
        && _activities.All(a => a.HasStoredDays);

    /// <summary>The stage that holds <paramref name="day"/> (the first by order), or null.</summary>
    public StageDefinition? StageContaining(int day) =>
        Stages.FirstOrDefault(s => s.StartDay <= day && day <= s.EndDay);

    // Single Create factory. Old callers that passed `stages` positionally must now use
    // named argument `stages:` — but all existing call sites pass only the first 4 params
    // positionally, so they compile without change. New callers use named params for
    // createdByUserId / tenantScope.
    public static ScheduleTemplate Create(
        Guid id,
        string name,
        string stage,
        DateTime createdAtUtc,
        UserId? createdByUserId = null,
        TenantScope tenantScope = TenantScope.Public,
        IReadOnlyCollection<StageDefinition>? stages = null)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("Template name is required.", nameof(name));
        }

        if (string.IsNullOrWhiteSpace(stage))
        {
            throw new ArgumentException("Template stage is required.", nameof(stage));
        }

        return new ScheduleTemplate(
            id,
            name.Trim(),
            stage.Trim(),
            createdAtUtc,
            createdByUserId,
            tenantScope,
            version: 1,
            previousVersionId: null,
            derivedFromTemplateId: null,
            stages);
    }

    // CEI-I1: copy-on-write edit — produces a NEW template row, original is NOT mutated.
    // spec: plr-d10 lane L8b-1 fix round 1 (review H3; founder D-88, 2026-11-06: "each version shows who made it") — the
    // new version records ITS maker, the editor; it replaces CEI-I2 ("author attribution preserved"), under which an edit
    // was stored as written by the schedule's first author. Whose schedule it stays is the first version's maker, read
    // back along PreviousVersionId (ShramSafal.Application.Services.ScheduleViewer.OwnerOfAsync).
    public ScheduleTemplate EditCopyOnWrite(
        Guid newId,
        string? newName,
        string? newStage,
        UserId editedByUserId,
        DateTime occurredAtUtc)
    {
        var copy = new ScheduleTemplate(
            newId,
            newName is not null ? newName.Trim() : Name,
            newStage is not null ? newStage.Trim() : Stage,
            occurredAtUtc,
            editedByUserId,        // the version's maker (D-88); the first version's maker stays the schedule's owner
            TenantScope,
            version: Version + 1,
            previousVersionId: Id,
            derivedFromTemplateId: null, // edit lineage does not chain root
            Stages);
        copy.OwnerType = OwnerType;
        copy.SourceLabel = SourceLabel;
        copy.CropKey = CropKey;
        copy.OwnFarmId = OwnFarmId; // spec: plr-d10 lane SCH-OWN - every version of a farm's own schedule names its farm

        // Copy activities by value onto the new template (SCH-A: the stored days, role and order travel with them; the
        // order link is remapped to the NEW activity ids — R34).
        copy.CopyActivitiesFrom(this);

        copy.Raise(new ScheduleTemplateEditedEvent(
            Guid.NewGuid(),
            occurredAtUtc,
            newId,
            Id,
            copy.Version,
            editedByUserId));

        return copy;
    }

    /// <summary>
    /// spec: plr-d10 lane SCH-OWN (Task 2; founder D-74, D-82 = 3) - a farm's OWN schedule, made EMPTY: version 1, <see cref="TenantScope.Team"/>
    /// (its team is the farm's people), the farmer's own (<see cref="ScheduleOwnerType.User"/>), for one crop, naming the FARM it belongs
    /// to. It stores no stage and no activity yet, so it <see cref="HasStoredDays">stores no days</see> and can never be followed or checked
    /// until a version with days is made (P4: nothing invented). The maker is the first version's maker, hence the schedule's owner
    /// (<c>ScheduleViewer.OwnerOfAsync</c>); the farm, not the owner, decides whose plots may follow it (R30).
    /// </summary>
    public static ScheduleTemplate CreateOwn(
        Guid id, string name, string cropKey, Guid ownFarmId, UserId madeBy, DateTime at)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Trim().Length > MaxNameLength)
        {
            throw new ArgumentException($"The schedule needs a name of 1 to {MaxNameLength} characters.", nameof(name));
        }

        if (string.IsNullOrWhiteSpace(cropKey) || cropKey.Trim().Length > MaxCropKeyLength)
        {
            throw new ArgumentException($"The schedule needs a crop of 1 to {MaxCropKeyLength} characters.", nameof(cropKey));
        }

        if (ownFarmId == Guid.Empty)
        {
            throw new ArgumentException("A farm's own schedule needs the farm.", nameof(ownFarmId));
        }

        return new ScheduleTemplate(
            id, name.Trim(), stage: string.Empty, at, madeBy, TenantScope.Team,
            version: 1, previousVersionId: null, derivedFromTemplateId: null)
        {
            OwnerType = ScheduleOwnerType.User,
            CropKey = cropKey.Trim(),
            OwnFarmId = ownFarmId,
        };
    }

    /// <summary>
    /// spec: plr-d10 lane SCH-OWN (Task 2; D7, P3) - the next version of a farm's own schedule with its stages and activities written WHOLE
    /// as sent: exactly these stages and exactly these works, none carried over from the version before (an absent work is gone, never
    /// kept by accident). The version before is not touched (P3: a correction never silently rewrites). The day rules are import's
    /// (D9, shared code, the same <c>ScheduleImport*</c> codes); the part is read case-blind from the four names; the server mints every
    /// id; the operation key is the draft's, else WORK-ID's proposal (W003: never coined here); role and nutrient are proposed as import
    /// does. <paramref name="newStage"/> is not used: with stages, <see cref="Stage"/> is the first stage by day. Returns <c>null</c> and
    /// the reason when a rule refuses it; nothing is raised or changed then.
    /// </summary>
    public ScheduleTemplate? EditCopyOnWrite(
        Guid newId,
        string? newName,
        string? newStage,
        IReadOnlyList<StageDefinition> stages,
        IReadOnlyList<ScheduleActivityDraft> activities,
        UserId editedByUserId,
        DateTime occurredAtUtc,
        out ScheduleImportProblem? problem)
    {
        _ = newStage; // the stage label of a version that has stages is its first stage
        problem = CheckStages(stages);
        if (problem is not null)
        {
            return null;
        }

        // Fix round 1 (M002): the sync contract's bounds (stages <= 40, activities <= 300, every day number <= 3650) are the SERVER's too - a request
        // that breaks them is a refusal with words (permanent for a phone), never a database fault.
        problem = CheckEditBounds(stages, activities);
        if (problem is not null)
        {
            return null;
        }

        var name = string.IsNullOrWhiteSpace(newName) ? Name : newName.Trim();
        if (name.Length > MaxNameLength)
        {
            problem = new("ScheduleImportName", $"The schedule needs a name of at most {MaxNameLength} characters.");
            return null;
        }

        var orderedStages = stages
            .Select(s => new StageDefinition(s.Name.Trim(), s.StartDay, s.EndDay))
            .OrderBy(s => s.StartDay).ThenBy(s => s.EndDay).ToList();
        var lastDay = orderedStages.Max(s => s.EndDay);

        var drafts = activities ?? [];
        var parts = new List<WorkPart>(drafts.Count);
        foreach (var a in drafts)
        {
            problem = CheckActivityDays(a.Name, a.StartDay, a.EndDay, a.FrequencyMode, a.IntervalDays, orderedStages, lastDay);
            if (problem is not null)
            {
                return null;
            }

            problem = CheckOperationKey(a);
            if (problem is not null)
            {
                return null;
            }

            if (!Enum.TryParse<WorkPart>(a.Part?.Trim(), ignoreCase: true, out var part) || !Enum.IsDefined(part))
            {
                problem = new("ScheduleImportPart", $"\"{a.Name.Trim()}\": the part \"{a.Part}\" is not one of irrigation, nutrition, spray, work.");
                return null;
            }

            parts.Add(part);
        }

        var copy = new ScheduleTemplate(
            newId,
            name,
            orderedStages[0].Name,
            occurredAtUtc,
            editedByUserId,        // the version's maker (D-88)
            TenantScope,
            version: Version + 1,
            previousVersionId: Id,
            derivedFromTemplateId: null, // edit lineage does not chain root
            orderedStages)
        {
            OwnerType = OwnerType,
            SourceLabel = SourceLabel,
            CropKey = CropKey,
            OwnFarmId = OwnFarmId,
        };

        for (var i = 0; i < drafts.Count; i++)
        {
            var a = drafts[i];
            var title = a.Name.Trim();
            var identity = WorkRecogniser.Recognise(title);
            var role = identity?.Role;
            var nutrientKey = role == "nutrient" ? identity?.NutrientKey : null;
            var operationKey = a.OperationKey is null ? identity?.OperationKey : a.OperationKey.Trim();

            copy._activities.Add(TemplateActivity.Stored(
                Guid.NewGuid(), newId, title, a.StartDay, a.EndDay, a.FrequencyMode,
                a.FrequencyMode == FrequencyMode.OneTime ? 1 : a.IntervalDays,
                parts[i].ToString(), operationKey, role, nutrientKey, afterActivityId: null));
        }

        copy.Raise(new ScheduleTemplateEditedEvent(
            Guid.NewGuid(),
            occurredAtUtc,
            newId,
            Id,
            copy.Version,
            editedByUserId));

        return copy;
    }

    // Clone — produces NEW template, preserves root lineage.
    public ScheduleTemplate Clone(
        Guid newId,
        UserId newOwnerUserId,
        TenantScope newScope,
        string reason,
        DateTime occurredAtUtc,
        Guid? ownFarmId = null)
    {
        var copy = new ScheduleTemplate(
            newId,
            Name,
            Stage,
            occurredAtUtc,
            newOwnerUserId,
            newScope,
            version: 1,
            previousVersionId: null,
            derivedFromTemplateId: DerivedFromTemplateId ?? Id, // always points to root
            Stages);
        // A farmer's copy is his own schedule; it keeps where it came from and what crop it is for. It is a NEW row, so it
        // starts NotChecked whatever the source was.
        copy.OwnerType = ScheduleOwnerType.User;
        copy.SourceLabel = SourceLabel;
        copy.CropKey = CropKey;
        // spec: plr-d10 lane SCH-OWN - a clone INTO a farm's own schedule names that farm (null = a plain copy: the source's farm is not carried).
        copy.OwnFarmId = ownFarmId;

        copy.CopyActivitiesFrom(this);

        copy.Raise(new ScheduleTemplateClonedEvent(
            Guid.NewGuid(),
            occurredAtUtc,
            newId,
            DerivedFromTemplateId ?? Id,
            newOwnerUserId,
            reason));

        return copy;
    }

    private void CopyActivitiesFrom(ScheduleTemplate source)
    {
        var newIdByOldId = new Dictionary<Guid, Guid>();
        foreach (var a in source._activities)
        {
            var copyActivity = a.CopyTo(Guid.NewGuid(), Id);
            newIdByOldId[a.Id] = copyActivity.Id;
            _activities.Add(copyActivity);
        }

        foreach (var a in _activities)
        {
            a.RemapAfter(newIdByOldId);
        }
    }

    // Publish — mutates this template.
    public void Publish(UserId publisherUserId, DateTime occurredAtUtc)
    {
        PublishedAtUtc = occurredAtUtc;
        Raise(new ScheduleTemplatePublishedEvent(
            Guid.NewGuid(),
            occurredAtUtc,
            Id,
            Version,
            publisherUserId));
    }

    public TemplateActivity AddActivity(
        Guid activityId,
        string activityName,
        int offsetDays,
        FrequencyMode frequencyMode = FrequencyMode.OneTime,
        int intervalDays = 1)
    {
        if (string.IsNullOrWhiteSpace(activityName))
        {
            throw new ArgumentException("Activity name is required.", nameof(activityName));
        }

        if (intervalDays <= 0)
        {
            throw new ArgumentException("Interval days must be greater than zero.", nameof(intervalDays));
        }

        var activity = new TemplateActivity(
            activityId,
            Id,
            activityName.Trim(),
            offsetDays,
            frequencyMode,
            intervalDays);
        _activities.Add(activity);
        return activity;
    }

    public void AddStage(StageDefinition stageDefinition)
    {
        if (string.IsNullOrWhiteSpace(stageDefinition.Name))
        {
            throw new ArgumentException("Stage name is required.", nameof(stageDefinition));
        }

        _stages.Add(new ScheduleTemplateStage(Guid.NewGuid(), Id, _stages.Count, stageDefinition.Name, stageDefinition.StartDay, stageDefinition.EndDay));
        var ordered = _stages.OrderBy(s => s.StartDay).ThenBy(s => s.EndDay).ToList();
        for (var i = 0; i < ordered.Count; i++)
        {
            ordered[i].OrderIndex = i;
        }
    }

    public void MarkGenerated(Guid cropCycleId, DateTime occurredAtUtc)
    {
        Raise(new PlanGeneratedEvent(
            Guid.NewGuid(),
            occurredAtUtc,
            cropCycleId,
            Id,
            _activities.Count));
    }
}
