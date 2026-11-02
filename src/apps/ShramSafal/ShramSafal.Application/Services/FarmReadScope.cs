using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 4a), lane MU-3 (founder D-22 / D-26) — what ONE person may
/// READ on ONE farm, derived from his standing (<see cref="FarmAccess"/>) by <see cref="FarmAccessPolicy"/>
/// alone: there is no second permission rule here, only the read consequence of the authorities the
/// primary account holder stored. The sync pull, the REST doors and the phone's purge all read this.
///
/// <list type="bullet">
/// <item><b>No working standing</b> (not a member, a waiting request, a paused or ended seat) → no scope:
/// nothing of the farm is sent.</item>
/// <item><b>Money</b> (cost entries, their corrections, the day ledger, job cards, finance summaries,
/// exports with amounts, the money a record states) → <see cref="FarmAuthority.SeeMoney"/>, or the
/// primary account holder.</item>
/// <item><b>Wages</b> on other people's labour → <see cref="FarmAuthority.SeeWages"/> (which needs see
/// money), or the primary account holder.</item>
/// <item><b>Attendance rulings</b> → <see cref="FarmAuthority.TakeAttendance"/>, or the primary account
/// holder.</item>
/// <item><b>Which records</b>: there is no authority for it. A कामगार (Worker) label reads his OWN records
/// only; every other working seat reads the farm's. A label may narrow, never widen (D-26). lane MU-4: the स्वतःचं काम
/// scope narrows the same way, and a chosen-plots scope narrows to his plots (<see cref="PlotIds"/>).</item>
/// <item><b>Tests</b> → every seat but an own-records-only one, or one holding
/// <see cref="FarmAuthority.LabRecords"/>. <b>Compliance warnings</b> → the same, or
/// <see cref="FarmAuthority.ConfirmRecords"/>. <b>The attention board and the planned work</b> → every
/// seat but an own-records-only one.</item>
/// </list>
/// </summary>
/// <param name="FarmId">The farm.</param>
/// <param name="OwnRecordsOnly">This seat reads only the records it made itself.</param>
/// <param name="SeeMoney">Money is sent.</param>
/// <param name="SeeWages">Wages on other people's labour are sent.</param>
/// <param name="SeeAttendance">Attendance rulings are sent.</param>
/// <param name="SeeTests">Test records are sent.</param>
/// <param name="SeeCompliance">Compliance warnings are sent.</param>
/// <param name="SeeFarmOverview">The attention board and the planned work are sent.</param>
/// <param name="IsPrimaryAccountHolder">The farm's primary account holder (reads everything; never on the wire).</param>
/// <param name="AccessChangedAtUtc">
/// When what this seat may read last changed (its grant, its approval, a status, label or authority
/// change); <c>null</c> for the registrant, who always reads everything. A pull whose cursor is older
/// re-sends the farm from the beginning (plan §2 #6).
/// </param>
public sealed record FarmReadScope(
    Guid FarmId,
    bool OwnRecordsOnly,
    bool SeeMoney,
    bool SeeWages,
    bool SeeAttendance,
    bool SeeTests,
    bool SeeCompliance,
    bool SeeFarmOverview,
    bool IsPrimaryAccountHolder,
    DateTime? AccessChangedAtUtc)
{
    /// <summary>
    /// spec: plr-d10 lane PRV fix pass 1 (L2) — the farm's REGISTRANT: the one person who sets a record's audience and
    /// always sees every record (D-26: "Only me" is his). The same rule <c>ManageMembershipHandler</c> uses for membership
    /// decisions — narrower than <see cref="IsPrimaryAccountHolder"/>, which also admits any Active PrimaryOwner seat
    /// (MU-3's <see cref="FarmAccessPolicy"/>, unchanged). Never on the wire.
    /// </summary>
    public bool IsRecordHolder { get; init; }

    /// <summary>
    /// spec: plr-d10 lane MU-4 (MU design §2 "Scope", §3 G2, §11.6) — the plots this seat covers; <c>null</c> = every plot
    /// (the default, the registrant, the primary owner, and an own-work seat, which reads by maker instead). A record, a
    /// cost, a task, a test or an attention item reaches him only when it is on one of these plots — or he made it, or it
    /// is assigned to him. The same one rule as the audience (<see cref="RecordVisibility"/>): both must allow a record.
    /// </summary>
    public IReadOnlySet<Guid>? PlotIds { get; init; }

    /// <summary>lane MU-4 — the seat's plot scope as stored (for the wire: the phone's pickers and its purge).</summary>
    public MembershipPlotScope PlotScope { get; init; } = MembershipPlotScope.AllPlots;

    /// <summary>lane MU-4 — does this seat cover <paramref name="plotId"/>? Every plot when it covers all.</summary>
    public bool CoversPlot(Guid plotId) => PlotIds is null || PlotIds.Contains(plotId);

    /// <summary>
    /// lane MU-4 (§11.6, §11.7) — may this seat read a task (a job card) on <paramref name="plotId"/>, assigned to
    /// <paramref name="assignedUserId"/>? An own-records-only seat: the tasks assigned to him (MU-3's rule, unchanged). Any
    /// other seat: a task on one of his plots (every task names its plot; a task on another plot is not his, even when it
    /// is assigned to him — the owner sees it and can move it).
    /// </summary>
    public bool MayReadTask(Guid readerUserId, Guid plotId, Guid? assignedUserId) =>
        OwnRecordsOnly
            ? readerUserId != Guid.Empty && assignedUserId == readerUserId
            : CoversPlot(plotId);

    /// <summary>
    /// The scope of <paramref name="access"/> at <paramref name="atUtc"/>; <c>null</c> when the standing
    /// reads nothing of the farm (<see cref="FarmAccessPolicy.MayRead"/>).
    /// </summary>
    public static FarmReadScope? Of(Guid farmId, FarmAccess? access, DateTime atUtc)
    {
        if (farmId == Guid.Empty || !FarmAccessPolicy.MayRead(access))
        {
            return null;
        }

        var primary = FarmAccessPolicy.IsPrimaryAccountHolder(access);
        bool Holds(FarmAuthority authority) => primary || FarmAccessPolicy.Holds(access, authority, atUtc);

        // D-26 — the label narrows, never widens: only the कामगार label narrows to his own records.
        // spec: plr-d10 lane MU-4 (§11.7) — and so does the स्वतःचं काम scope: ONE own-records rule for both.
        var ownOnly = !primary && (access!.Role == AppRole.Worker || access.OwnWorkScope);
        return new FarmReadScope(
            farmId,
            OwnRecordsOnly: ownOnly,
            SeeMoney: Holds(FarmAuthority.SeeMoney),
            SeeWages: Holds(FarmAuthority.SeeWages),
            SeeAttendance: Holds(FarmAuthority.TakeAttendance),
            SeeTests: !ownOnly || Holds(FarmAuthority.LabRecords),
            SeeCompliance: !ownOnly || Holds(FarmAuthority.ConfirmRecords),
            SeeFarmOverview: !ownOnly,
            IsPrimaryAccountHolder: primary,
            AccessChangedAtUtc: access!.IsRegistrant ? null : access.AccessChangedAtUtc)
        {
            IsRecordHolder = access.IsRegistrant,
            PlotIds = primary ? null : access.CoveredPlotIds,
            PlotScope = primary ? MembershipPlotScope.AllPlots : access.PlotScope,
        };
    }

    /// <summary>May this seat read the record <paramref name="operatorUserId"/> made?</summary>
    public bool MayReadRecordOf(Guid readerUserId, Guid operatorUserId) =>
        !OwnRecordsOnly || (readerUserId != Guid.Empty && operatorUserId == readerUserId);
}

/// <summary>
/// lane MU-3 — the async half of <see cref="FarmReadScope"/>: load the caller's standing on THIS farm
/// (the same <see cref="IShramSafalRepository.GetFarmAccessForUserAsync"/> every authority gate reads)
/// and answer. A REST door maps <c>null</c> / a missing read to <c>ShramSafalErrors.Forbidden</c>.
/// </summary>
public static class FarmReadGate
{
    public static async Task<FarmReadScope?> ScopeAsync(
        IShramSafalRepository repository,
        Guid farmId,
        Guid userId,
        DateTime atUtc,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);

        if (farmId == Guid.Empty || userId == Guid.Empty)
        {
            return null;
        }

        var access = await repository.GetFarmAccessForUserAsync(farmId, userId, ct);
        return FarmReadScope.Of(farmId, access, atUtc);
    }

    /// <summary>The farm's money (and every read that carries an amount) for this caller?</summary>
    public static async Task<bool> MaySeeMoneyAsync(
        IShramSafalRepository repository, Guid farmId, Guid userId, DateTime atUtc, CancellationToken ct = default) =>
        (await ScopeAsync(repository, farmId, userId, atUtc, ct))?.SeeMoney == true;
}
