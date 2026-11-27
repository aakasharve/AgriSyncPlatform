using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Sync.PullSyncChanges;

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, contract §2.9 / §3.3 S3; founder 27 Nov: the saved screen's read-only "हे दिसतं:
/// मालक, मुकादम") — for a phone that ASKS (<c>seenBy=1</c>), per farm: who, other than the farm's registrant (always first, implied) and the reader
/// himself, would see a work record THIS reader makes, who sees हजेरी, and who sees money. Built from the farm's REAL live seats and the SAME read rule
/// every door applies (<see cref="FarmReadScope.Of"/>), never guessed (P4): a seat that reads only its own records sees none of his work; a seat on chosen
/// plots is listed with those plots (the phone keeps the ones that cover the record's plots); money lists nobody while the farm's money is private.
/// <para><b>Name-free:</b> each entry is a seat's label (<c>CoOwner</c> / <c>Family</c> / <c>Mukadam</c> / <c>Worker</c>), else its role — never a name, a
/// user id or a count; equal entries are told once.</para>
/// </summary>
internal static class PullSeenBy
{
    public static async Task<IReadOnlyDictionary<Guid, SeenByDto>> OfAsync(
        IShramSafalRepository repository,
        Guid readerUserId,
        IReadOnlyCollection<Guid> farmIds,
        IReadOnlySet<Guid> moneyPrivateFarms,
        DateTime nowUtc,
        CancellationToken ct)
    {
        var result = new Dictionary<Guid, SeenByDto>();
        foreach (var farmId in farmIds.Distinct())
        {
            var farm = await repository.GetFarmByIdAsync(farmId, ct);
            if (farm is null)
            {
                continue;
            }

            var work = new List<SeenByEntryDto>();
            var attendance = new List<SeenByEntryDto>();
            var money = new List<SeenByEntryDto>();
            foreach (var seat in await repository.GetLiveSeatsOfFarmForMemberAsync(farmId, readerUserId, ct))
            {
                // E4 — a seat of THIS farm, live and working, that is neither the registrant (implied, always first) nor the reader himself.
                if (seat.FarmId != new FarmId(farmId) || seat.Status != MembershipStatus.Active
                    || seat.UserId == farm.OwnerUserId || seat.UserId == new UserId(readerUserId))
                {
                    continue;
                }

                var scope = FarmReadScope.Of(farmId, AccessOf(seat), nowUtc);
                if (scope is null)
                {
                    continue;
                }

                var who = seat.Label?.ToString() ?? seat.Role.ToString();
                var plots = scope.PlotIds is { } covered ? covered.Order().ToList() : null;
                if (!scope.OwnRecordsOnly)
                {
                    work.Add(new SeenByEntryDto(who, plots));
                }

                if (scope.SeeAttendance)
                {
                    attendance.Add(new SeenByEntryDto(who));
                }

                if (scope.SeeMoney && !scope.OwnRecordsOnly && !moneyPrivateFarms.Contains(farmId))
                {
                    money.Add(new SeenByEntryDto(who, plots));
                }
            }

            result[farmId] = new SeenByDto(Grouped(work), Grouped(attendance), Grouped(money));
        }

        return result;
    }

    /// <summary>The standing of one seat as the access rule reads it (the registrant is never asked here).</summary>
    private static FarmAccess AccessOf(FarmMembership seat) =>
        new(
            seat.Role,
            seat.Status,
            IsRegistrant: false,
            seat.Permissions,
            seat.CanManageLabourRecords,
            seat.LabourGrantExpiresAtUtc,
            seat.AuthorityExpiresAtJson,
            seat.AccessChangedAtUtc,
            seat.PlotScope,
            seat.ScopePlotIds,
            seat.AllowedWorkKinds,
            seat.WorkKindsChangedAtUtc);

    /// <summary>Equal entries told once, in a stable order (by label, then a seat on every plot before chosen plots, then by plots).</summary>
    private static IReadOnlyList<SeenByEntryDto> Grouped(IEnumerable<SeenByEntryDto> entries) =>
        entries
            .GroupBy(e => (e.Who, Plots: e.PlotIds is null ? string.Empty : string.Join(",", e.PlotIds)))
            .Select(g => g.First())
            .OrderBy(e => e.Who, StringComparer.Ordinal)
            .ThenBy(e => e.PlotIds is null ? 0 : 1)
            .ThenBy(e => e.PlotIds is null ? string.Empty : string.Join(",", e.PlotIds), StringComparer.Ordinal)
            .ToList();
}
