using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Finance;

namespace ShramSafal.Domain.Planning;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 3, "Own schedule store and make main"; approved spec plr-d10-schedule-approved-spec-2026-11-23)

/// <summary>Whether a work of a person's own schedule is in it now. A removed work keeps its row and its history (P3); saving its key again brings it back.</summary>
public enum OwnScheduleItemState
{
    Active = 0,
    Removed = 1,
}

/// <summary>What one revision of an own work records.</summary>
public enum OwnScheduleItemAction
{
    Saved = 0,
    Removed = 1,
}

/// <summary>
/// One work of a farmer's OWN schedule while it is being built, kept on its own and NEVER on the main schedule until the farmer says "हेच मुख्य करा"
/// (<see cref="ScheduleTemplate.FreezeOwn"/>): a first work saved on a plot that follows a reference changes neither the main schedule nor its stage line
/// (review focus 2). One row per (plot-season, task key): the id is a UUIDv5 of the crop season and the key (<see cref="IdFor"/>), so two phones that
/// save the same key offline land on ONE item, and the later save is an edit of it (review focus 1), never a refusal.
/// <para><b>Current truth and history (P3).</b> This row holds the current content; every save and every removal also writes an append-only
/// <see cref="OwnScheduleItemRevision"/>. The row is changed in place; the revisions are never changed.</para>
/// <para><b>Owner.</b> <see cref="OwnerUserId"/> is the owner of the farm (<c>ssf.farms.owner_user_id</c>) at the time of the write, copied from the farm row
/// the gate trusted, NEVER from a request body. The database refuses any other value (trigger in the migration).</para>
/// <para><b>Origin.</b> <see cref="Origin"/> is where the work came from, set by its FIRST save and never changed after (approved spec: origin never
/// changes): an edit that sends another origin keeps the stored one.</para>
/// </summary>
public sealed class OwnScheduleItem : Entity<Guid>
{
    /// <summary>The fixed namespace of every own-work id. Never changes.</summary>
    public static readonly Guid IdNamespace = Guid.Parse("0b6a8d52-7c3e-4f19-9a21-5e7d3c8b4f60");

    private OwnScheduleItem() : base(Guid.Empty) { } // EF Core

    private OwnScheduleItem(
        Guid id, FarmId farmId, Guid plotId, Guid cropCycleId, UserId ownerUserId, ScheduleTaskContent content, UserId byUserId, DateTime atUtc)
        : base(id)
    {
        FarmId = farmId;
        PlotId = plotId;
        CropCycleId = cropCycleId;
        OwnerUserId = ownerUserId;
        TaskKey = content.TaskKey;
        Origin = content.Origin;
        SetContent(content);
        State = OwnScheduleItemState.Active;
        Revision = 1;
        CreatedByUserId = byUserId;
        CreatedAtUtc = atUtc;
        UpdatedByUserId = byUserId;
        UpdatedAtUtc = atUtc;
    }

    public FarmId FarmId { get; private set; }
    public Guid PlotId { get; private set; }
    public Guid CropCycleId { get; private set; }

    /// <summary>The owner of the farm when this row was last written (from the farm row, never a body).</summary>
    public UserId OwnerUserId { get; private set; }

    /// <summary>The task key: permanent for this work, and the key of its task in every version it is frozen into.</summary>
    public string TaskKey { get; private set; } = string.Empty;

    /// <summary>Where the work came from (its first save's origin), or null. Never changed after the first save.</summary>
    public string? Origin { get; private set; }

    /// <summary>The work as it is now, in the one task format.</summary>
    public ScheduleTaskContent Content { get; private set; } = default!;

    public string ContentHash { get; private set; } = string.Empty;

    // ---- the queryable parts, derived from Content whenever it is set (never set apart from it) ----
    public string Name { get; private set; } = string.Empty;
    public ScheduleTaskKind Kind { get; private set; }
    public ScheduleTimerKind TimerKind { get; private set; }
    public int StageIndex { get; private set; }
    public int Order { get; private set; }

    public OwnScheduleItemState State { get; private set; }

    /// <summary>1 for the first save, one more for every save or removal after it (the number of the newest revision).</summary>
    public int Revision { get; private set; }

    /// <summary>
    /// The version of the schedule this plot-season's own works were last frozen into by "हेच मुख्य करा" (and by every change made after it), or null
    /// while the own schedule is still being built. Every active item of the plot-season carries the same value after a freeze.
    /// </summary>
    public Guid? MainVersionId { get; private set; }

    public UserId CreatedByUserId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public UserId UpdatedByUserId { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }

    /// <summary>The id of the work <paramref name="taskKey"/> of the crop season <paramref name="cropCycleId"/>: the same on every phone and every server.</summary>
    public static Guid IdFor(Guid cropCycleId, string taskKey)
    {
        ArgumentException.ThrowIfNullOrEmpty(taskKey);
        return MoneyEntryIdentity.V5(IdNamespace, $"{cropCycleId.ToString("D").ToLowerInvariant()}:{taskKey}");
    }

    /// <summary>
    /// The first save of a work. Refused (null, and the reason) when the content does not hold together (<see cref="ScheduleTaskContent.Check"/>);
    /// never for a missing optional part (P9).
    /// </summary>
    public static OwnScheduleItem? Create(
        FarmId farmId, Guid plotId, Guid cropCycleId, UserId ownerUserId, ScheduleTaskContent content, UserId byUserId, DateTime atUtc,
        out OwnScheduleItemRevision? revision, out ScheduleTaskProblem? problem)
    {
        revision = null;
        if (CheckPlace(farmId, plotId, cropCycleId, ownerUserId, byUserId) is { } place)
        {
            problem = place;
            return null;
        }

        problem = content is null ? new ScheduleTaskProblem("ScheduleTaskKey", "A task is missing.") : content.Check();
        if (problem is not null)
        {
            return null;
        }

        var normalized = content!.Normalized();
        var item = new OwnScheduleItem(IdFor(cropCycleId, normalized.TaskKey), farmId, plotId, cropCycleId, ownerUserId, normalized, byUserId, atUtc);
        revision = OwnScheduleItemRevision.Of(item, OwnScheduleItemAction.Saved);
        return item;
    }

    /// <summary>
    /// A later save of the same key: the content is replaced WHOLE (origin kept), the state is Active again, and one revision is written. A save that
    /// changes nothing (same content, already active) writes nothing and returns the newest revision number unchanged (<paramref name="revision"/> null).
    /// </summary>
    public bool Save(ScheduleTaskContent content, UserId ownerUserId, UserId byUserId, DateTime atUtc, out OwnScheduleItemRevision? revision, out ScheduleTaskProblem? problem)
    {
        revision = null;
        problem = content is null ? new ScheduleTaskProblem("ScheduleTaskKey", "A task is missing.") : content.Check();
        if (problem is not null)
        {
            return false;
        }

        if (!string.Equals(content!.TaskKey, TaskKey, StringComparison.Ordinal))
        {
            problem = new("OwnScheduleItemKey", $"This work is '{TaskKey}'; a save names '{content.TaskKey}'.");
            return false;
        }

        if (ownerUserId.IsEmpty || byUserId.IsEmpty)
        {
            problem = new("OwnScheduleItemPlace", "A save names the farm's owner and who saved it.");
            return false;
        }

        var normalized = content.Normalized() with { Origin = Origin };
        var hash = normalized.ContentHash();
        if (State == OwnScheduleItemState.Active && hash == ContentHash && ownerUserId == OwnerUserId)
        {
            return true;
        }

        SetContent(normalized);
        State = OwnScheduleItemState.Active;
        Touch(ownerUserId, byUserId, atUtc);
        revision = OwnScheduleItemRevision.Of(this, OwnScheduleItemAction.Saved);
        return true;
    }

    /// <summary>Takes the work out of the own schedule. The row and its history stay (P3). Removing a removed work changes nothing (<paramref name="revision"/> null).</summary>
    public void Remove(UserId ownerUserId, UserId byUserId, DateTime atUtc, out OwnScheduleItemRevision? revision)
    {
        revision = null;
        if (State == OwnScheduleItemState.Removed)
        {
            return;
        }

        State = OwnScheduleItemState.Removed;
        Touch(ownerUserId, byUserId, atUtc);
        revision = OwnScheduleItemRevision.Of(this, OwnScheduleItemAction.Removed);
    }

    /// <summary>Records the version this plot-season's own works were frozen into (no revision: the content is unchanged).</summary>
    public void MarkMainVersion(Guid versionId, DateTime atUtc)
    {
        if (versionId == Guid.Empty)
        {
            throw new ArgumentException("A version id is required.", nameof(versionId));
        }

        MainVersionId = versionId;
        UpdatedAtUtc = atUtc;
    }

    private void SetContent(ScheduleTaskContent content)
    {
        Content = content;
        ContentHash = content.ContentHash();
        Name = content.Name;
        Kind = content.Kind;
        TimerKind = content.Timing.Timer;
        StageIndex = content.StageIndex;
        Order = content.Order;
    }

    private void Touch(UserId ownerUserId, UserId byUserId, DateTime atUtc)
    {
        OwnerUserId = ownerUserId;
        Revision++;
        UpdatedByUserId = byUserId;
        UpdatedAtUtc = atUtc;
    }

    private static ScheduleTaskProblem? CheckPlace(FarmId farmId, Guid plotId, Guid cropCycleId, UserId ownerUserId, UserId byUserId) =>
        farmId.IsEmpty || plotId == Guid.Empty || cropCycleId == Guid.Empty || ownerUserId.IsEmpty || byUserId.IsEmpty
            ? new ScheduleTaskProblem("OwnScheduleItemPlace", "An own work names its farm, plot, crop season, the farm's owner and who saved it.")
            : null;
}

/// <summary>
/// One save or removal of one own work (<c>ssf.own_schedule_item_revisions</c>): APPEND-ONLY by privilege (the application role has SELECT and INSERT only).
/// It holds the whole content at that moment, so the history of a work can always be read back (P3), and who wrote it, when, and the farm's owner then.
/// </summary>
public sealed class OwnScheduleItemRevision : Entity<Guid>
{
    private OwnScheduleItemRevision() : base(Guid.Empty) { } // EF Core

    private OwnScheduleItemRevision(Guid id, OwnScheduleItem item, OwnScheduleItemAction action)
        : base(id)
    {
        ItemId = item.Id;
        FarmId = item.FarmId;
        PlotId = item.PlotId;
        CropCycleId = item.CropCycleId;
        OwnerUserId = item.OwnerUserId;
        TaskKey = item.TaskKey;
        RevisionNumber = item.Revision;
        Action = action;
        State = item.State;
        Content = item.Content;
        ContentHash = item.ContentHash;
        Name = item.Name;
        ByUserId = item.UpdatedByUserId;
        AtUtc = item.UpdatedAtUtc;
    }

    public Guid ItemId { get; private set; }
    public FarmId FarmId { get; private set; }
    public Guid PlotId { get; private set; }
    public Guid CropCycleId { get; private set; }
    public UserId OwnerUserId { get; private set; }
    public string TaskKey { get; private set; } = string.Empty;
    public int RevisionNumber { get; private set; }
    public OwnScheduleItemAction Action { get; private set; }
    public OwnScheduleItemState State { get; private set; }
    public ScheduleTaskContent Content { get; private set; } = default!;
    public string ContentHash { get; private set; } = string.Empty;
    public string Name { get; private set; } = string.Empty;
    public UserId ByUserId { get; private set; }
    public DateTime AtUtc { get; private set; }

    internal static OwnScheduleItemRevision Of(OwnScheduleItem item, OwnScheduleItemAction action) => new(Guid.NewGuid(), item, action);
}
