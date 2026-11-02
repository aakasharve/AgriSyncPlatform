using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10 lane MU-4 fix pass 1 (H1; MU design §3 G2: "outside the scope … neither sent nor accepted") — the ONE
/// write-side plot question, asked INSIDE every handler that changes something bound to a plot, after it has loaded its
/// entity: so a REST route a phone calls online (1.0.17 and the current app) and a sync change that names no plot (a
/// warning's id, a task's id) are refused exactly like a push that names one. A seat that covers CHOSEN plots may write
/// only on those plots; every other seat (all plots, own work: "he may log on any plot", §11.7) is never refused here, nor
/// is a caller with no seat (the handler's own membership rule answers him, as before).
/// <para>Cheap for everyone else: a seat that may read by place is found first by one bounded read
/// (<see cref="IShramSafalRepository.GetFarmsMaybeReadByPlaceAsync"/>, a test double answers "none"), and only then is
/// his scope read. The refusal is <see cref="ShramSafalErrors.PlotScopeForbidden"/> — its code ends in ".Forbidden", so
/// every phone parks it visibly (P10), and a REST door answers 403.</para>
/// </summary>
public static class PlotScopeGate
{
    /// <summary>
    /// <see cref="ShramSafalErrors.PlotScopeForbidden"/> when <paramref name="userId"/> covers chosen plots on
    /// <paramref name="farmId"/> and any of <paramref name="plotIds"/> is not one of them; otherwise <c>null</c>.
    /// </summary>
    public static async Task<Error?> RefuseAsync(
        IShramSafalRepository repository,
        Guid farmId,
        IEnumerable<Guid?> plotIds,
        Guid userId,
        DateTime atUtc,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(plotIds);
        var named = plotIds.Where(p => p is { } id && id != Guid.Empty).Select(p => p!.Value).Distinct().ToList();
        if (farmId == Guid.Empty || userId == Guid.Empty || named.Count == 0)
        {
            return null;
        }

        if ((await repository.GetFarmsMaybeReadByPlaceAsync(userId, [farmId], ct)).Count == 0)
        {
            return null;
        }

        var scope = await FarmReadGate.ScopeAsync(repository, farmId, userId, atUtc, ct);
        return scope?.PlotIds is { } his && !named.All(his.Contains) ? ShramSafalErrors.PlotScopeForbidden : null;
    }

    /// <summary>
    /// The plots <paramref name="userId"/> covers on <paramref name="farmId"/> when his seat covers CHOSEN plots; <c>null</c>
    /// for every other seat (and for a caller with no seat). Read only when the cheap pre-filter finds such a seat.
    /// </summary>
    public static async Task<IReadOnlySet<Guid>?> ChosenPlotsAsync(
        IShramSafalRepository repository, Guid farmId, Guid userId, DateTime atUtc, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        if (farmId == Guid.Empty || userId == Guid.Empty
            || (await repository.GetFarmsMaybeReadByPlaceAsync(userId, [farmId], ct)).Count == 0)
        {
            return null;
        }

        var scope = await FarmReadGate.ScopeAsync(repository, farmId, userId, atUtc, ct);
        return scope is { IsPrimaryAccountHolder: false } ? scope.PlotIds : null;
    }

    /// <summary>The same question for one plot.</summary>
    public static Task<Error?> RefuseAsync(
        IShramSafalRepository repository, Guid farmId, Guid? plotId, Guid userId, DateTime atUtc, CancellationToken ct = default) =>
        RefuseAsync(repository, farmId, [plotId], userId, atUtc, ct);

    /// <summary>
    /// The same question for a crop season on <paramref name="farmId"/>: its plot. The season is read only for a seat
    /// that may read by place; one not found asks nothing (the handler answers), and one on ANOTHER farm is refused for
    /// such a seat (E4: a season id never carries his write onto a plot of another farm).
    /// </summary>
    public static async Task<Error?> RefuseCycleAsync(
        IShramSafalRepository repository, Guid farmId, Guid cropCycleId, Guid userId, DateTime atUtc, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        if (farmId == Guid.Empty || cropCycleId == Guid.Empty || userId == Guid.Empty
            || (await repository.GetFarmsMaybeReadByPlaceAsync(userId, [farmId], ct)).Count == 0)
        {
            return null;
        }

        var cycle = await repository.GetCropCycleByIdAsync(cropCycleId, ct);
        if (cycle is null)
        {
            return null;
        }

        var scope = await FarmReadGate.ScopeAsync(repository, farmId, userId, atUtc, ct);
        if (scope?.PlotIds is not { } his)
        {
            return null;
        }

        return (Guid)cycle.FarmId != farmId || !his.Contains(cycle.PlotId) ? ShramSafalErrors.PlotScopeForbidden : null;
    }
}
