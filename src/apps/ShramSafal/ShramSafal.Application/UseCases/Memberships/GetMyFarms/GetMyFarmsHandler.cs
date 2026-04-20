using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;

namespace ShramSafal.Application.UseCases.Memberships.GetMyFarms;

public sealed record GetMyFarmsCommand(UserId CallerUserId);

public sealed record SubscriptionSnapshot(
    int StatusCode,
    string Status,
    string PlanCode,
    DateTime ValidUntilUtc,
    bool AllowsOwnerWrites);

public sealed record MyFarmDto(
    Guid FarmId,
    string Name,
    string Role,
    string? FarmCode,
    SubscriptionSnapshot? Subscription);

public sealed record MyFarmsResult(IReadOnlyList<MyFarmDto> Farms);

/// <summary>
/// List of farms the caller is an active member of. Each farm includes
/// its current subscription snapshot (may be null if the farm is
/// somehow detached from an OwnerAccount, which Phase 2 backfill
/// prevents but we handle defensively).
/// </summary>
public sealed class GetMyFarmsHandler(
    IShramSafalRepository repository,
    ISubscriptionReader subscriptionReader)
{
    public async Task<Result<MyFarmsResult>> HandleAsync(GetMyFarmsCommand command, CancellationToken ct = default)
    {
        if (command.CallerUserId.IsEmpty)
        {
            return Result.Failure<MyFarmsResult>(new Error("me.unauthenticated", "Caller must be authenticated."));
        }

        var farmIds = await repository.GetFarmIdsForUserAsync(command.CallerUserId.Value, ct);

        var farms = new List<MyFarmDto>(farmIds.Count);
        foreach (var farmId in farmIds)
        {
            var farm = await repository.GetFarmByIdAsync(farmId, ct);
            if (farm is null) continue;

            var role = await repository.GetUserRoleForFarmAsync(farmId, command.CallerUserId.Value, ct);

            SubscriptionSnapshot? snapshot = null;
            if (!farm.OwnerAccountId.IsEmpty)
            {
                var sub = await subscriptionReader.GetByOwnerAccountAsync(farm.OwnerAccountId, ct);
                if (sub is not null)
                {
                    snapshot = new SubscriptionSnapshot(
                        StatusCode: sub.Status,
                        Status: MapStatus(sub.Status),
                        PlanCode: sub.PlanCode,
                        ValidUntilUtc: sub.ValidUntilUtc,
                        AllowsOwnerWrites: sub.AllowsOwnerWrites);
                }
            }

            farms.Add(new MyFarmDto(
                FarmId: farmId,
                Name: farm.Name,
                Role: role?.ToString() ?? "Worker",
                FarmCode: farm.FarmCode,
                Subscription: snapshot));
        }

        return Result.Success(new MyFarmsResult(farms));
    }

    private static string MapStatus(int code) => code switch
    {
        1 => "Trialing",
        2 => "Active",
        3 => "PastDue",
        4 => "Expired",
        5 => "Canceled",
        6 => "Suspended",
        _ => "Unknown",
    };
}
