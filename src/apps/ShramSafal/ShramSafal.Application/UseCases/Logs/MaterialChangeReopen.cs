using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.UseCases.Logs;

/// <summary>
/// spec: plr-d10 (lane L6 rule, written in <c>ReviseLogContentHandler</c>; shared with lane OF-S's
/// <c>move_daily_log</c>) — what the record says changed, so a confirmation that covered the old version no longer
/// covers it: an <c>Edit</c> marker takes a confirmed day back to Draft. When the person who changed it is the
/// record's own creator and his server-derived role may confirm his own saves, the day is re-confirmed at the NEW
/// version (the <c>AddLogTaskHandler</c> rule); everyone else's change waits in the owner's inbox.
///
/// <para>Every event written here is strictly LATER than everything already on the record (the status fold is
/// <c>OrderBy(OccurredAtUtc).Last()</c>), the same 1 ms rule as <c>AddLogTaskHandler</c>. Call it AFTER the version
/// has moved, so a re-confirmation records the version it covers.</para>
/// </summary>
internal static class MaterialChangeReopen
{
    public readonly record struct Outcome(
        VerificationStatus PriorStatus,
        VerificationEvent? ReOpen,
        bool ReAttested,
        string? ReAttestedRole);

    public static Outcome Apply(
        DailyLog log,
        Guid actorUserId,
        AppRole? actorRole,
        bool isCreator,
        DateTime nowUtc,
        IIdGenerator idGenerator)
    {
        var priorStatus = log.CurrentVerificationStatus;
        if (priorStatus == VerificationStatus.Draft)
        {
            return new Outcome(priorStatus, null, false, null);
        }

        var lastEventAtUtc = log.VerificationEvents.Count == 0
            ? DateTime.MinValue
            : log.VerificationEvents.Max(e => e.OccurredAtUtc);
        var reOpenAtUtc = nowUtc > lastEventAtUtc ? nowUtc : lastEventAtUtc.AddMilliseconds(1);

        var reOpen = log.Edit(idGenerator.New(), new UserId(actorUserId), reOpenAtUtc);

        if (reOpen is not null && isCreator
            && actorRole is { } role
            && log.TrySelfVerifyAsCreator(idGenerator.New(), idGenerator.New(), role, reOpenAtUtc.AddMilliseconds(1)))
        {
            return new Outcome(priorStatus, reOpen, true, role.ToString());
        }

        return new Outcome(priorStatus, reOpen, false, null);
    }
}
