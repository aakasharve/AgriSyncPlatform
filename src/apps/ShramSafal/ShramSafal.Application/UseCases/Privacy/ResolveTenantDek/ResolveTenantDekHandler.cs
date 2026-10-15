// spec: data-principle-spine-2026-05-05/05.2
//
// Sub-phase 05.2 — sibling to IssueTenantDekHandler. Resolves a
// previously-issued DEK by handing the wrapped DekId to
// ITenantDekService.ResolveAsync; returns Result.Failure with a NotFound
// error when KMS cannot unwrap (wrong tenant, wrong region, disabled
// key). Audit row is emitted on every call (Issued vs ResolveFailed) so
// the export bundle records both successful unwraps and rejected attempts.

using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using AgriSync.BuildingBlocks.Security;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Privacy.ResolveTenantDek;

public sealed class ResolveTenantDekHandler(
    IShramSafalRepository repository,
    ITenantDekService tenantDekService)
{
    public async Task<Result<ResolveTenantDekResult>> HandleAsync(
        ResolveTenantDekCommand command,
        CancellationToken ct = default)
    {
        if (command.UserId == Guid.Empty)
        {
            return Result.Failure<ResolveTenantDekResult>(ShramSafalErrors.JoinUnauthenticated);
        }

        if (command.FarmId == Guid.Empty || string.IsNullOrWhiteSpace(command.DekId))
        {
            return Result.Failure<ResolveTenantDekResult>(ShramSafalErrors.InvalidCommand);
        }

        // D1 (2026-10-15): the owner account is derived from the farm the caller names,
        // only after the caller is proven an Active member (or declared owner) of it.
        // See IssueTenantDekHandler. A non-member never reaches KMS.
        var (isActiveMember, ownerAccountId) = await repository
            .GetActiveFarmMembershipForTenantAsync(command.FarmId, command.UserId, ct)
            .ConfigureAwait(false);
        if (!isActiveMember || ownerAccountId == Guid.Empty)
        {
            return Result.Failure<ResolveTenantDekResult>(ShramSafalErrors.Forbidden);
        }

        var plaintext = await tenantDekService
            .ResolveAsync(ownerAccountId, command.DekId, ct)
            .ConfigureAwait(false);

        var resolved = plaintext is not null;
        var auditEvent = AuditEventFactory.Create(
            entityType: "TenantDek",
            entityId: Guid.NewGuid(),
            action: resolved ? "Resolved" : "ResolveFailed",
            actorUserId: command.UserId,
            actorRole: string.IsNullOrWhiteSpace(command.ActorRole) ? "Unknown" : command.ActorRole.Trim(),
            payload: new
            {
                dekId = command.DekId,
                ownerAccountId,
                resolved,
            },
            farmId: command.FarmId,
            clientCommandId: null,
            appVersion: string.IsNullOrWhiteSpace(command.ClientAppVersion)
                ? AppVersionProvider.Current
                : command.ClientAppVersion,
            deviceId: command.AuditDeviceId,
            ipHash: command.AuditIpHash,
            sourceAiJobId: null);

        await repository.AddAuditEventAsync(auditEvent, ct).ConfigureAwait(false);
        await repository.SaveChangesAsync(ct).ConfigureAwait(false);

        if (plaintext is null)
        {
            // Reuse the canonical NotFound code so the endpoint adapter
            // routes to 404 via the standard Error.Kind → status mapping.
            return Result.Failure<ResolveTenantDekResult>(
                Error.NotFound("ShramSafal.TenantDekNotFound", "Tenant DEK could not be resolved."));
        }

        return Result.Success(new ResolveTenantDekResult(
            DekBase64: Convert.ToBase64String(plaintext)));
    }
}
