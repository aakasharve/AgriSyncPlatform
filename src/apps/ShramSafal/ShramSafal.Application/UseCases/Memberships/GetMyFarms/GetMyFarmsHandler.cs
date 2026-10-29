using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Memberships.GetMyFarms;

/// <param name="IncludePending">spec: plr-d7-m1-multiuser-2026-10-26 (step 1, P11) — list the
/// seats that are NOT Active (a typed-code request waiting for the owner, a paused seat) too.
/// Only the route's <c>?includePending=true</c> sets it, and only this release's phone sends
/// that. Without it the answer is Active seats only — exactly what an installed older app (the
/// 1.0.16 APK) understood "my farms" to mean before step 1, so it is never handed a farm it would
/// show as an ordinary farm it cannot open.</param>
public sealed record GetMyFarmsCommand(UserId CallerUserId, bool IncludePending = false);

/// <param name="AllowsOwnerWrites">What the server's entitlement gate will do for paid writes: true
/// for a Trialing/Active subscription, and (spec R-11 b) also true while the account has an active
/// server-managed access extension.</param>
/// <param name="AccessExtendedUntilUtc">spec R-11 (b) — ADDITIVE, last (older apps ignore it): the end
/// of the active access extension, or null when none is active. Lets a screen say the truth — the
/// subscription's own status is unchanged, access continues because of the extension.</param>
public sealed record SubscriptionSnapshot(
    int StatusCode,
    string Status,
    string PlanCode,
    DateTime ValidUntilUtc,
    bool AllowsOwnerWrites,
    DateTime? AccessExtendedUntilUtc = null);

/// <param name="Status">spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — ADDITIVE, last: the
/// caller's seat status on this farm (<c>"Active"</c>, <c>"PendingApproval"</c>,
/// <c>"Suspended"</c>, <c>"PendingOtpClaim"</c>). Only <c>"Active"</c> means access; any other
/// value is a relationship the phone must show as such, never as an ordinary farm. Older apps
/// ignore the field, which is why they are never sent a non-Active seat: those are listed only
/// on <c>?includePending=true</c> (<see cref="GetMyFarmsCommand.IncludePending"/>).</param>
public sealed record MyFarmDto(
    Guid FarmId,
    string Name,
    string Role,
    string? FarmCode,
    SubscriptionSnapshot? Subscription,
    string Status = "Active",
    string? StatusReason = null);

public sealed record MyFarmsResult(IReadOnlyList<MyFarmDto> Farms);

/// <summary>
/// List of farms the caller owns or holds a seat on that has not ended. Each farm includes
/// its current subscription snapshot (may be null if the farm is
/// somehow detached from an OwnerAccount, which Phase 2 backfill
/// prevents but we handle defensively).
///
/// <para>spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — a seat that is not Active (a typed-code
/// join request waiting for the owner, a paused seat) is listed ONLY when the caller asked with
/// <see cref="GetMyFarmsCommand.IncludePending"/>, and then with its <c>Status</c> and the farm's
/// name only: no farm code and no subscription snapshot. The person has not been let in, so this
/// answer carries nothing of the farm beyond what they already know. Without the flag such a seat
/// is left out, so an older installed app sees the list it always saw (doctrine P11).</para>
/// </summary>
public sealed class GetMyFarmsHandler(
    IShramSafalRepository repository,
    ISubscriptionReader subscriptionReader,
    IClock clock)
{
    public async Task<Result<MyFarmsResult>> HandleAsync(GetMyFarmsCommand command, CancellationToken ct = default)
    {
        if (command.CallerUserId.IsEmpty)
        {
            return Result.Failure<MyFarmsResult>(Error.Unauthenticated("me.unauthenticated", "Caller must be authenticated."));
        }

        // Single user-scoped projection: opens its own tx + SET LOCAL agrisync.user_id
        // so the p_user_select_* RLS policies surface the caller's owned + member farms
        // on the admin-elevated /shramsafal/farms/mine route (the interceptor injects no
        // farm_id GUC there, so the legacy farm_id-keyed policy would hide every row).
        var rows = await repository.GetMyFarmsAsync(command.CallerUserId.Value, ct);

        var farms = new List<MyFarmDto>(rows.Count);
        foreach (var row in rows)
        {
            if (row.Status != MembershipStatus.Active)
            {
                if (!command.IncludePending)
                {
                    // An older app ignores Status and would show this as a farm it can open.
                    continue;
                }

                farms.Add(new MyFarmDto(
                    FarmId: row.FarmId,
                    Name: row.Name,
                    Role: row.Role?.ToString() ?? "Worker",
                    FarmCode: null,
                    Subscription: null,
                    Status: row.Status.ToString(),
                    // spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — ADDITIVE, last: the owner's
                    // reason, for a paused seat only ("काम थांबवलं — कारण…").
                    StatusReason: row.StatusReason));
                continue;
            }

            SubscriptionSnapshot? snapshot = null;
            if (row.OwnerAccountId != Guid.Empty)
            {
                var ownerAccountId = new OwnerAccountId(row.OwnerAccountId);
                var sub = await subscriptionReader.GetByOwnerAccountAsync(ownerAccountId, ct);
                if (sub is not null)
                {
                    // spec R-11 (b) — same rule as DefaultEntitlementPolicy: an active extension keeps
                    // paid writes allowed, so the phone does not tell the owner "expired" while the
                    // server is accepting his work.
                    var extension = sub.AllowsOwnerWrites
                        ? null
                        : await subscriptionReader.GetActiveAccessExtensionAsync(ownerAccountId, clock.UtcNow, ct);
                    snapshot = new SubscriptionSnapshot(
                        StatusCode: sub.Status,
                        Status: MapStatus(sub.Status),
                        PlanCode: sub.PlanCode,
                        ValidUntilUtc: sub.ValidUntilUtc,
                        AllowsOwnerWrites: sub.AllowsOwnerWrites || extension is not null,
                        AccessExtendedUntilUtc: extension?.EndsAtUtc);
                }
            }

            farms.Add(new MyFarmDto(
                FarmId: row.FarmId,
                Name: row.Name,
                Role: row.Role?.ToString() ?? "Worker",
                FarmCode: row.FarmCode,
                Subscription: snapshot,
                Status: row.Status.ToString()));
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
