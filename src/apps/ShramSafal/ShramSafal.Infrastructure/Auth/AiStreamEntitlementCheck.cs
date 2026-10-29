using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases;
using ShramSafal.Infrastructure.Persistence;

namespace ShramSafal.Infrastructure.Auth;

/// <summary>
/// spec R-11 (d) — see <see cref="IAiStreamEntitlementCheck"/>. Reuses the reviewed farm-scope
/// technique (<see cref="ICallerFarmTenantScope.EstablishForCallerAsync"/>) and the one entitlement
/// translation (<see cref="EntitlementGate"/>); it sets no GUC of its own.
/// </summary>
internal sealed class AiStreamEntitlementCheck(
    ShramSafalDbContext db,
    ICallerFarmTenantScope callerScope,
    IEntitlementPolicy policy) : IAiStreamEntitlementCheck
{
    public async Task<Error?> CheckAsync(Guid farmId, Guid userId, CancellationToken ct = default)
    {
        if (farmId == Guid.Empty || userId == Guid.Empty)
        {
            return Error.Validation("ShramSafal.InvalidCommand", "farm_id is required.");
        }

        // A route inside the request transaction (or a non-relational test provider) needs no
        // transaction of its own; the skip-listed live-caption route does, because the farm scope
        // is transaction-local.
        var ownTransaction = db.Database.IsRelational() && db.Database.CurrentTransaction is null
            ? await db.Database.BeginTransactionAsync(ct)
            : null;
        try
        {
            var scope = await callerScope.EstablishForCallerAsync(farmId, userId, ct);
            if (!scope.IsSuccess)
            {
                return scope.Error;
            }

            return await EntitlementGate.CheckErrorAsync(
                policy, new UserId(userId), new FarmId(farmId), PaidFeature.AiParse, ct);
        }
        finally
        {
            if (ownTransaction is not null)
            {
                // Read-only question: nothing to keep. Rolling back also drops the farm GUCs, so
                // the rest of the request runs exactly as before (admin-elevated, global config only).
                await ownTransaction.RollbackAsync(CancellationToken.None);
                await ownTransaction.DisposeAsync();
            }
        }
    }
}
