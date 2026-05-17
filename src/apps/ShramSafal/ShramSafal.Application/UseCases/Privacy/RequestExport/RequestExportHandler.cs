// spec: data-principle-spine-2026-05-05/08.3
//
// Sub-phase 08.3 — endpoint-side enqueue for DPDP §11 / §11(1)(c)
// export. Returns 202 + requestId. ExportWorker assembles the ZIP +
// stamps the presigned URL asynchronously.

using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Privacy;

namespace ShramSafal.Application.UseCases.Privacy.RequestExport;

public sealed class RequestExportHandler(
    IShramSafalRepository repository,
    TimeProvider clock)
{
    public async Task<Result<RequestExportResult>> HandleAsync(
        RequestExportCommand command,
        CancellationToken ct = default)
    {
        if (command.RequestedByUserId == Guid.Empty)
        {
            return Result.Failure<RequestExportResult>(ShramSafalErrors.JoinUnauthenticated);
        }

        var nowUtc = clock.GetUtcNow().UtcDateTime;
        var request = ExportRequest.Submit(command.RequestedByUserId, nowUtc);

        await repository.AddExportRequestAsync(request, ct).ConfigureAwait(false);

        var audit = AuditEventFactory.Create(
            entityType: "DataExport",
            entityId: request.Id,
            action: "Requested",
            actorUserId: command.RequestedByUserId,
            actorRole: "data_principal",
            payload: new
            {
                requestId = request.Id,
                requestedByUserId = command.RequestedByUserId,
                requestedAtUtc = nowUtc,
            },
            farmId: null,
            clientCommandId: null,
            appVersion: command.ClientAppVersion,
            deviceId: command.AuditDeviceId,
            ipHash: command.AuditIpHash);
        await repository.AddAuditEventAsync(audit, ct).ConfigureAwait(false);

        await repository.SaveChangesAsync(ct).ConfigureAwait(false);

        return Result.Success(new RequestExportResult(
            RequestId: request.Id,
            RequestedAtUtc: nowUtc));
    }
}
