// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-1 (founder D-24 / D-24c / D-24e1, D-26, D-79; E4).
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning.PlannedWork;

/// <summary>One person the caller may give work to, with the plots his seat covers (the phone's picker).</summary>
/// <param name="UserId">The member.</param>
/// <param name="DisplayName">His name as the farm sees it (null when he has none).</param>
/// <param name="Role">His seat's label, for the picker's words. Grants nothing (D-26).</param>
/// <param name="PlotScope"><c>AllPlots</c>, <c>ChosenPlots</c> or <c>OwnWork</c>.</param>
/// <param name="PlotIds">The plots he covers: every plot of the farm for all-plots and own-work seats, his chosen ones otherwise.</param>
public sealed record PlannedWorkAssigneeDto(Guid UserId, string? DisplayName, string Role, string PlotScope, IReadOnlyList<Guid> PlotIds);

/// <summary>
/// The REST reads of the task record. Every read goes through <see cref="PlannedWorkVisibility"/> - the SAME rule as the
/// pull - so a worker who is neither the maker nor the assignee gets nothing from here either, and another farm's task id
/// answers exactly like a made-up one (E4).
/// </summary>
public sealed class PlannedWorkReads(IShramSafalRepository repository, IClock clock)
{
    /// <summary>The tasks of the farm this person may see (with only the plot rows he sees), newest change last.</summary>
    public async Task<Result<IReadOnlyList<PlannedWorkDto>>> ListAsync(
        Guid farmId, Guid callerUserId, DateTime? sinceUtc, CancellationToken ct = default)
    {
        var seat = await PlannedWorkSeats.OfAsync(repository, farmId, callerUserId, clock.UtcNow, ct);
        if (!seat.Active)
        {
            return Result.Failure<IReadOnlyList<PlannedWorkDto>>(ShramSafalErrors.Forbidden);
        }

        var rows = await repository.GetPlannedWorkChangedSinceAsync([farmId], sinceUtc ?? DateTime.UnixEpoch, ct);
        var seen = rows
            .Where(w => (Guid)w.FarmId == farmId)
            .Select(w => (Work: w, Rows: PlannedWorkVisibility.VisiblePlots(seat, w)))
            .Where(x => x.Rows is not null)
            .ToList();
        var standing = await PlannedWorkConfirmations.LoadAsync(repository, seen.Select(x => x.Work), ct);
        IReadOnlyList<PlannedWorkDto> visible = seen.Select(x => PlannedWorkDto.From(x.Work, x.Rows!, standing)).ToList();
        return Result.Success(visible);
    }

    /// <summary>One task, when this person may see it; otherwise exactly the answer for a made-up id.</summary>
    public async Task<Result<PlannedWorkDto>> GetAsync(Guid farmId, Guid plannedWorkId, Guid callerUserId, CancellationToken ct = default)
    {
        var (work, seat, refusal) = await PlannedWorkDoor.OpenAsync(
            repository, plannedWorkId, farmId, callerUserId, clock.UtcNow, mustSee: true, ct);
        return refusal is not null || work is null
            ? Result.Failure<PlannedWorkDto>(refusal ?? ShramSafalErrors.PlannedWorkNotFound)
            : Result.Success(await PlannedWorkDoor.DtoAsync(repository, work, seat, ct));
    }

    /// <summary>
    /// The Active members the caller may give work to (never himself: that is a reminder), each with the plots he covers. Only
    /// the primary account holder and a holder of AssignWork may ask (D-24c); anyone else is
    /// <see cref="ShramSafalErrors.Forbidden"/>.
    /// </summary>
    public async Task<Result<IReadOnlyList<PlannedWorkAssigneeDto>>> AssigneesAsync(
        Guid farmId, Guid callerUserId, CancellationToken ct = default)
    {
        var seat = await PlannedWorkSeats.OfAsync(repository, farmId, callerUserId, clock.UtcNow, ct);
        if (!seat.Active || !(seat.IsPrimaryOwner || seat.HoldsAssignWork))
        {
            return Result.Failure<IReadOnlyList<PlannedWorkAssigneeDto>>(ShramSafalErrors.Forbidden);
        }

        var farmKey = new FarmId(farmId);
        var members = (await repository.GetFarmMembershipsAsync(farmKey, ct))
            .Where(m => m.FarmId == farmKey && m.Status == MembershipStatus.Active && m.UserId.Value != callerUserId)
            .OrderBy(m => m.GrantedAtUtc)
            .ToList();
        if (members.Count == 0)
        {
            return Result.Success<IReadOnlyList<PlannedWorkAssigneeDto>>([]);
        }

        var names = (await repository.GetOperatorsByIdsAsync(members.Select(m => m.UserId.Value), ct))
            .Where(o => !string.IsNullOrWhiteSpace(o.DisplayName))
            .ToDictionary(o => o.UserId, o => o.DisplayName);
        var farmPlots = (await repository.GetPlotsByFarmIdAsync(farmId, ct))
            .Where(p => (Guid)p.FarmId == farmId)
            .Select(p => p.Id)
            .Order()
            .ToList();

        IReadOnlyList<PlannedWorkAssigneeDto> list = members
            .Select(m =>
            {
                var chosen = m.Role != AgriSync.SharedKernel.Contracts.Roles.AppRole.PrimaryOwner && m.PlotScope == MembershipPlotScope.ChosenPlots;
                return new PlannedWorkAssigneeDto(
                    m.UserId.Value,
                    names.GetValueOrDefault(m.UserId.Value),
                    m.Role.ToString(),
                    chosen ? nameof(MembershipPlotScope.ChosenPlots) : m.Role == AgriSync.SharedKernel.Contracts.Roles.AppRole.PrimaryOwner
                        ? nameof(MembershipPlotScope.AllPlots)
                        : m.PlotScope.ToString(),
                    chosen ? m.ScopePlotIds.Where(farmPlots.Contains).Order().ToList() : farmPlots);
            })
            .ToList();
        return Result.Success(list);
    }
}
