using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Planning;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 2, "Task format and three timers"; approved spec plr-d10-schedule-approved-spec-2026-11-23)

/// <summary>
/// One task of one VERSION of a schedule (<c>ssf.schedule_tasks</c>), kept beside the stored activities (<c>template_activities</c>), never in place of
/// them: a row with no tasks reads exactly as it did. A task row is written once with its version and never changed (append-only by privilege; a change
/// is a new version, P3). Its identity across versions is <see cref="TaskKey"/>; the row id is new in every version.
/// <para><b>What is stored.</b> The whole <see cref="Content"/> as canonical JSON (nothing of it can be lost) and the hash taken over that JSON, plus the
/// few parts a query needs as columns (key, stage, order, kind, timer, the day window, the key it follows). The columns are DERIVED from the content when the row
/// is made and the row is never updated, so they cannot disagree with it.</para>
/// <para><b>The tenant.</b> <see cref="TenantScope"/> and <see cref="OwnerUserId"/> are copied from the version's template when the task is added (a template's
/// scope and owner never change), so row-level security can decide on the row itself: a library row (Public) is read by every user scope; a Team row by its owner
/// and the people who work on a farm of that owner; a Private row by its owner. A template has no farm to key on (the library row belongs to no farm, and a person's
/// own schedule is his across every farm he owns), which is why this is a user-keyed policy, not a farm-keyed one.</para>
/// </summary>
public sealed class ScheduleTask : Entity<Guid>
{
    private ScheduleTask() : base(Guid.Empty) { } // EF Core

    private ScheduleTask(Guid id, Guid scheduleTemplateId, TenantScope tenantScope, UserId? ownerUserId, ScheduleTaskContent content)
        : base(id)
    {
        var normalized = content.Normalized();
        ScheduleTemplateId = scheduleTemplateId;
        TenantScope = tenantScope;
        OwnerUserId = ownerUserId;
        Content = normalized;
        ContentHash = normalized.ContentHash();
        TaskKey = normalized.TaskKey;
        StageIndex = normalized.StageIndex;
        Order = normalized.Order;
        Name = normalized.Name;
        Kind = normalized.Kind;
        TimerKind = normalized.Timing.Timer;
        FromDay = normalized.Timing.Timer == ScheduleTimerKind.Day ? normalized.Timing.FromDay : null;
        ToDay = normalized.Timing.Timer == ScheduleTimerKind.Day ? normalized.Timing.ToDay : null;
        AfterTaskKey = normalized.Timing.Timer == ScheduleTimerKind.After ? normalized.Timing.AfterTaskKey : null;
    }

    public Guid ScheduleTemplateId { get; private set; }

    /// <summary>The scope of the version this task belongs to, copied at creation (row security decides on it).</summary>
    public TenantScope TenantScope { get; private set; }

    /// <summary>The person whose schedule the version is (its owner, else its maker), copied at creation; null for a row with neither.</summary>
    public UserId? OwnerUserId { get; private set; }

    // ---- the queryable parts, derived from Content ----
    public string TaskKey { get; private set; } = string.Empty;
    public int StageIndex { get; private set; }
    public int Order { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public ScheduleTaskKind Kind { get; private set; }
    public ScheduleTimerKind TimerKind { get; private set; }
    public int? FromDay { get; private set; }
    public int? ToDay { get; private set; }
    public string? AfterTaskKey { get; private set; }

    /// <summary>Everything the task says. Immutable.</summary>
    public ScheduleTaskContent Content { get; private set; } = default!;

    /// <summary>SHA-256 over <see cref="Content"/>'s canonical JSON: it changes when any field of the task changes.</summary>
    public string ContentHash { get; private set; } = string.Empty;

    /// <summary>A new row for <paramref name="content"/> in the version <paramref name="scheduleTemplateId"/> (the caller has checked the content).</summary>
    internal static ScheduleTask From(Guid scheduleTemplateId, TenantScope tenantScope, UserId? ownerUserId, ScheduleTaskContent content) =>
        new(Guid.NewGuid(), scheduleTemplateId, tenantScope, ownerUserId, content);

    /// <summary>The same task for a copy of its version: a new id, the same content (so the same key and the same hash).</summary>
    internal ScheduleTask CopyTo(Guid newTemplateId, TenantScope tenantScope, UserId? ownerUserId) =>
        new(Guid.NewGuid(), newTemplateId, tenantScope, ownerUserId, Content);
}

/// <summary>
/// One challenge of one version of a schedule (<c>ssf.schedule_challenges</c>): the same rules as <see cref="ScheduleTask"/> (written once with its version,
/// the whole content as canonical JSON with its hash, the tenant copied from the version).
/// </summary>
public sealed class ScheduleChallenge : Entity<Guid>
{
    private ScheduleChallenge() : base(Guid.Empty) { } // EF Core

    private ScheduleChallenge(Guid id, Guid scheduleTemplateId, TenantScope tenantScope, UserId? ownerUserId, ScheduleChallengeContent content)
        : base(id)
    {
        var normalized = content.Normalized();
        ScheduleTemplateId = scheduleTemplateId;
        TenantScope = tenantScope;
        OwnerUserId = ownerUserId;
        Content = normalized;
        ContentHash = normalized.ContentHash();
        ChallengeKey = normalized.ChallengeKey;
        StageIndex = normalized.StageIndex;
        Order = normalized.Order;
        Title = normalized.Title;
    }

    public Guid ScheduleTemplateId { get; private set; }
    public TenantScope TenantScope { get; private set; }
    public UserId? OwnerUserId { get; private set; }
    public string ChallengeKey { get; private set; } = string.Empty;
    public int StageIndex { get; private set; }
    public int Order { get; private set; }
    public string Title { get; private set; } = string.Empty;
    public ScheduleChallengeContent Content { get; private set; } = default!;
    public string ContentHash { get; private set; } = string.Empty;

    internal static ScheduleChallenge From(Guid scheduleTemplateId, TenantScope tenantScope, UserId? ownerUserId, ScheduleChallengeContent content) =>
        new(Guid.NewGuid(), scheduleTemplateId, tenantScope, ownerUserId, content);

    internal ScheduleChallenge CopyTo(Guid newTemplateId, TenantScope tenantScope, UserId? ownerUserId) =>
        new(Guid.NewGuid(), newTemplateId, tenantScope, ownerUserId, Content);
}
