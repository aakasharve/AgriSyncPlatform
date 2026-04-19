using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Memberships.ExitMembership;

/// <summary>
/// The caller exits their own membership on a given farm. Enforces
/// invariant I3 — if the caller is the last active PrimaryOwner, the
/// exit is denied (they must transfer ownership first, which is a
/// future spec).
///
/// Self-exit only: the endpoint does not accept a target-user id. An
/// owner revoking someone else's membership is a different use case
/// (<c>RevokeMembershipHandler</c>, deferred).
/// </summary>
public sealed class ExitMembershipHandler(
    IShramSafalRepository repository,
    IClock clock,
    IAnalyticsWriter analytics)
{
    public async Task<Result<ExitMembershipResult>> HandleAsync(
        FarmId farmId,
        UserId callerUserId,
        CancellationToken ct = default)
    {
        if (farmId.IsEmpty || callerUserId.IsEmpty)
        {
            return Result.Failure<ExitMembershipResult>(new Error("exit.invalid", "Missing farm or user id."));
        }

        var membership = await repository.GetFarmMembershipAsync(farmId.Value, callerUserId.Value, ct);
        if (membership is null)
        {
            return Result.Failure<ExitMembershipResult>(new Error(
                "exit.no_membership",
                "You are not a member of this farm."));
        }

        if (membership.IsTerminal)
        {
            return Result.Success(new ExitMembershipResult(membership.Id, AlreadyExited: true));
        }

        // Invariant I3 guard: if the caller is a PrimaryOwner, they can
        // only exit if another active PrimaryOwner remains.
        bool isLastActivePrimaryOwner = false;
        if (membership.Role == AppRole.PrimaryOwner)
        {
            var activePrimaryOwnerCount = await repository.CountActivePrimaryOwnersAsync(farmId.Value, ct);
            isLastActivePrimaryOwner = activePrimaryOwnerCount <= 1;
        }

        var exitAtUtc = clock.UtcNow;
        try
        {
            membership.Exit(exitAtUtc, isLastActivePrimaryOwner);
        }
        catch (LastPrimaryOwnerRevocationException)
        {
            return Result.Failure<ExitMembershipResult>(new Error(
                "exit.last_primary_owner",
                "You are the only primary owner of this farm. Promote someone else first."));
        }

        await repository.SaveChangesAsync(ct);

        await analytics.EmitAsync(new AnalyticsEvent(
            EventId: Guid.NewGuid(),
            EventType: AnalyticsEventType.MembershipRevoked,
            OccurredAtUtc: exitAtUtc,
            ActorUserId: callerUserId,
            FarmId: farmId,
            OwnerAccountId: null,
            ActorRole: membership.Role.ToString().ToLowerInvariant(),
            Trigger: "manual",
            DeviceOccurredAtUtc: null,
            SchemaVersion: "v1",
            PropsJson: System.Text.Json.JsonSerializer.Serialize(new
            {
                farmId = farmId.Value,
                exitedByUserId = callerUserId.Value,
                role = membership.Role.ToString().ToLowerInvariant()
            })
        ), ct);

        return Result.Success(new ExitMembershipResult(membership.Id, AlreadyExited: false));
    }
}
