// spec: data-principle-spine-2026-05-05/05.2
//
// Sub-phase 05.2 — first handler under the new UseCases/Privacy/ folder
// (per OQ-1 verdict, conflict-resolver 2026-05-17). Issues a per-tenant
// Data Encryption Key (DEK) bound to the caller's owner account via the
// KMS EncryptionContext, and emits one AuditEvent row per issuance so
// the export bundle (Phase 08) can replay every DEK lifecycle event.
//
// Architecture rules:
//   - Lives in Application. Domain has no knowledge of KMS.
//   - Calls only Domain ports + the BuildingBlocks ITenantDekService port.
//     No Infrastructure types reach this file.
//   - Reads OwnerAccountId from the per-request TenantContext; the endpoint
//     short-circuits to 401 when no tenant claim is present.

using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using AgriSync.BuildingBlocks.Security;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Privacy.IssueTenantDek;

public sealed class IssueTenantDekHandler(
    IShramSafalRepository repository,
    ITenantDekService tenantDekService,
    TenantContext tenantContext)
{
    public async Task<Result<IssueTenantDekResult>> HandleAsync(
        IssueTenantDekCommand command,
        CancellationToken ct = default)
    {
        if (command.UserId == Guid.Empty)
        {
            return Result.Failure<IssueTenantDekResult>(ShramSafalErrors.JoinUnauthenticated);
        }

        // Owner-account scope is the unit of tenancy for the DEK
        // EncryptionContext binding — the per-request TenantContext already
        // holds it (stamped by TenantTransactionMiddleware on every business
        // request). Reject when missing: no plaintext DEK should ever be
        // issued without a tenant binding.
        if (tenantContext.OwnerAccountId is not { } ownerAccountId || ownerAccountId == Guid.Empty)
        {
            return Result.Failure<IssueTenantDekResult>(ShramSafalErrors.JoinUnauthenticated);
        }

        var dek = await tenantDekService.IssueAsync(ownerAccountId, ct).ConfigureAwait(false);

        var auditEvent = AuditEventFactory.Create(
            entityType: "TenantDek",
            // The DekId is opaque base64-url-safe text, not a Guid, so the
            // AuditEvent.entity_id column gets a freshly-minted Guid that
            // correlates DEK lifecycle events for this caller via the
            // payload (which records the actual DekId). entity_id is
            // required to be non-empty; the payload carries the real key.
            entityId: Guid.NewGuid(),
            action: "Issued",
            actorUserId: command.UserId,
            actorRole: string.IsNullOrWhiteSpace(command.ActorRole) ? "Unknown" : command.ActorRole.Trim(),
            payload: new
            {
                dekId = dek.DekId,
                ownerAccountId,
                expiresAtUtc = dek.ExpiresAtUtc,
            },
            farmId: tenantContext.FarmId,
            clientCommandId: null,
            appVersion: string.IsNullOrWhiteSpace(command.ClientAppVersion)
                ? AppVersionProvider.Current
                : command.ClientAppVersion,
            deviceId: command.AuditDeviceId,
            ipHash: command.AuditIpHash,
            sourceAiJobId: null);

        await repository.AddAuditEventAsync(auditEvent, ct).ConfigureAwait(false);
        await repository.SaveChangesAsync(ct).ConfigureAwait(false);

        return Result.Success(new IssueTenantDekResult(
            DekId: dek.DekId,
            DekBase64: Convert.ToBase64String(dek.DekBytes),
            ExpiresAtUtc: dek.ExpiresAtUtc));
    }
}
