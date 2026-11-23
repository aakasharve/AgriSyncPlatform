using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Planning;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 2, "Task format and three timers"; approved spec plr-d10-schedule-approved-spec-2026-11-23)

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
