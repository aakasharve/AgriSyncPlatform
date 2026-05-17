// spec: data-principle-spine-2026-05-05/08.2
//
// Sub-phase 08.2 — endpoint-side enqueue for DPDP §12 erasure. Both
// self-serve and admin-on-behalf-of flow funnel through this handler
// (OQ-2). The handler is intentionally tiny: it persists a Requested
// row + emits one ErasureRequested audit row + returns 202. The async
// ErasureWorker (Infrastructure) does all the heavy lifting.

using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Privacy;

namespace ShramSafal.Application.UseCases.Privacy.RequestErasure;

public sealed class RequestErasureHandler(
    IShramSafalRepository repository,
    TimeProvider clock)
{
    public async Task<Result<RequestErasureResult>> HandleAsync(
        RequestErasureCommand command,
        CancellationToken ct = default)
    {
        if (command.RequestedByUserId == Guid.Empty)
        {
            return Result.Failure<RequestErasureResult>(ShramSafalErrors.JoinUnauthenticated);
        }
        if (command.OnBehalfOfUserId is { } target && target == Guid.Empty)
        {
            return Result.Failure<RequestErasureResult>(ShramSafalErrors.InvalidCommand);
        }

        var nowUtc = clock.GetUtcNow().UtcDateTime;
        var request = ErasureRequest.Submit(
            requestedByUserId: command.RequestedByUserId,
            onBehalfOfUserId: command.OnBehalfOfUserId,
            nowUtc: nowUtc);

        await repository.AddErasureRequestAsync(request, ct).ConfigureAwait(false);

        // Audit at request time per OQ-6 (per-row Applied audits land
        // when the worker runs; this is the "request received" event).
        var audit = AuditEventFactory.Create(
            entityType: "ErasureRequest",
            entityId: request.Id,
            action: "Requested",
            actorUserId: command.RequestedByUserId,
            actorRole: command.OnBehalfOfUserId is null ? "data_principal" : "admin_security_responder",
            payload: new
            {
                requestId = request.Id,
                requestedByUserId = command.RequestedByUserId,
                onBehalfOfUserId = command.OnBehalfOfUserId,
                requestedAtUtc = nowUtc,
            },
            farmId: null,
            clientCommandId: null,
            appVersion: command.ClientAppVersion,
            deviceId: command.AuditDeviceId,
            ipHash: command.AuditIpHash);
        await repository.AddAuditEventAsync(audit, ct).ConfigureAwait(false);

        await repository.SaveChangesAsync(ct).ConfigureAwait(false);

        return Result.Success(new RequestErasureResult(
            RequestId: request.Id,
            RequestedAtUtc: nowUtc));
    }
}
