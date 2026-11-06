// spec: data-principle-spine-2026-05-05/08.2
//
// Sub-phase 08.2 — endpoint-side enqueue for DPDP §12 erasure. Both
// self-serve and admin-on-behalf-of flow funnel through this handler
// (OQ-2). The handler is intentionally tiny: it persists a Requested
// row + emits one ErasureRequested audit row + returns 202. The async
// ErasureWorker (Infrastructure) does all the heavy lifting.

using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Privacy;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Privacy;

namespace ShramSafal.Application.UseCases.Privacy.RequestErasure;

public sealed class RequestErasureHandler(
    IShramSafalRepository repository,
    TimeProvider clock,
    ErasureTiming timing)
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

        // spec: plr-d10 lane F99 fix pass 2 (review N-1) — ONE waiting request per person. While a request for this person
        // (whoever filed it: he himself, the platform admin on his behalf, an installed 1.0.17) still waits, asking again
        // answers THAT request and its date: nothing new is made and the 30 days do not restart. So "cancel" always ends
        // the only thing that would erase him. A cancelled or finished request does not count.
        var targetUserId = command.OnBehalfOfUserId ?? command.RequestedByUserId;
        if (await repository.GetWaitingErasureRequestForAsync(targetUserId, ct).ConfigureAwait(false) is { } waiting)
        {
            return await AnswerFromExistingAsync(command, waiting, ct).ConfigureAwait(false);
        }

        var nowUtc = clock.GetUtcNow().UtcDateTime;
        var request = ErasureRequest.Submit(
            requestedByUserId: command.RequestedByUserId,
            onBehalfOfUserId: command.OnBehalfOfUserId,
            nowUtc: nowUtc);

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

        // spec: plr-d10 lane OPS-1 (L-1) - the database allows only one waiting request per person. If a second request
        // for the same person arrived at the same moment and was stored first, the store refuses ours and we answer THAT
        // request, exactly as the check above would have.
        if (!await repository.TryAddErasureRequestAsync(request, audit, ct).ConfigureAwait(false))
        {
            if (await repository.GetWaitingErasureRequestForAsync(targetUserId, ct).ConfigureAwait(false) is { } winner)
            {
                return await AnswerFromExistingAsync(command, winner, ct).ConfigureAwait(false);
            }

            return Result.Failure<RequestErasureResult>(ShramSafalErrors.InvalidCommand);
        }

        // lane F99 fix pass 1, item 11 (D-71) — nothing is erased now: the request waits, and the answer says until when.
        return Result.Success(new RequestErasureResult(
            RequestId: request.Id,
            RequestedAtUtc: nowUtc,
            ErasureStartsAtUtc: timing.ErasureStartsAtUtc(request)));
    }

    /// <summary>
    /// A request for this person already waits: answer THAT request and its date, make nothing new, and leave an audit
    /// row saying so (L-1) - a person asking again, or an admin on his behalf, is a fact worth keeping.
    /// </summary>
    private async Task<Result<RequestErasureResult>> AnswerFromExistingAsync(
        RequestErasureCommand command, ErasureRequest waiting, CancellationToken ct)
    {
        var audit = AuditEventFactory.Create(
            entityType: "ErasureRequest",
            entityId: waiting.Id,
            action: "RequestAnsweredFromExisting",
            actorUserId: command.RequestedByUserId,
            actorRole: command.OnBehalfOfUserId is null ? "data_principal" : "admin_security_responder",
            payload: new
            {
                requestId = waiting.Id,
                askedByUserId = command.RequestedByUserId,
                onBehalfOfUserId = command.OnBehalfOfUserId,
                originalRequestedAtUtc = waiting.RequestedAtUtc,
            },
            farmId: null,
            clientCommandId: null,
            appVersion: command.ClientAppVersion,
            deviceId: command.AuditDeviceId,
            ipHash: command.AuditIpHash);
        await repository.AddAuditEventAsync(audit, ct).ConfigureAwait(false);
        await repository.SaveChangesAsync(ct).ConfigureAwait(false);

        return Result.Success(new RequestErasureResult(
            RequestId: waiting.Id,
            RequestedAtUtc: waiting.RequestedAtUtc,
            ErasureStartsAtUtc: timing.ErasureStartsAtUtc(waiting),
            AlreadyWaiting: true));
    }
}
