// spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99 fix pass 1, item 11 (founder D-71, 2026-11-02).
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Privacy;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Privacy;

namespace ShramSafal.Application.UseCases.Privacy.CancelErasure;

public sealed record CancelErasureCommand(
    Guid RequestId,
    Guid CallerUserId,
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");

public sealed record CancelErasureResult(Guid RequestId, string Status, DateTime CancelledAtUtc);

/// <summary>
/// The person who asked for an erasure cancels it while it still waits (founder D-71). Nothing has been erased and
/// nothing will be.
///
/// <list type="bullet">
/// <item><b>Who:</b> only the person who ASKED (<see cref="ErasureRequest.RequestedByUserId"/>): the data principal for
/// his own request, the platform admin for one he asked on someone's behalf. Anyone else's request, and a made-up id,
/// answer exactly the same <see cref="ShramSafalErrors.ErasureRequestNotFound"/> (E4).</item>
/// <item><b>When:</b> only while it waits. Once the worker has taken it, it is refused with
/// <see cref="ShramSafalErrors.ErasureAlreadyStarted"/>. A second cancel of a cancelled request answers as the first
/// (a phone that sends it twice is told the truth).</item>
/// <item><b>Race:</b> the change is one guarded UPDATE (status still Requested), the same guard the worker's claim uses,
/// so a cancel and the worker's start can never both win.</item>
/// </list>
/// </summary>
public sealed class CancelErasureHandler(IShramSafalRepository repository, TimeProvider clock)
{
    public async Task<Result<CancelErasureResult>> HandleAsync(CancelErasureCommand command, CancellationToken ct = default)
    {
        if (command.CallerUserId == Guid.Empty)
        {
            return Result.Failure<CancelErasureResult>(ShramSafalErrors.JoinUnauthenticated);
        }

        var request = await repository.GetErasureRequestByIdAsync(command.RequestId, ct).ConfigureAwait(false);
        if (request is null || request.RequestedByUserId != command.CallerUserId)
        {
            return Result.Failure<CancelErasureResult>(ShramSafalErrors.ErasureRequestNotFound);
        }

        if (request.Status == ErasureStatus.Cancelled)
        {
            return Result.Success(new CancelErasureResult(request.Id, nameof(ErasureStatus.Cancelled), request.CompletedAtUtc ?? default));
        }

        if (!request.IsWaiting)
        {
            return Result.Failure<CancelErasureResult>(ShramSafalErrors.ErasureAlreadyStarted);
        }

        var nowUtc = clock.GetUtcNow().UtcDateTime;
        if (!await repository.TryCancelErasureRequestAsync(request.Id, nowUtc, ct).ConfigureAwait(false))
        {
            // The worker took it between the read and the guarded UPDATE: it has started.
            return Result.Failure<CancelErasureResult>(ShramSafalErrors.ErasureAlreadyStarted);
        }

        await repository.AddAuditEventAsync(AuditEventFactory.Create(
            entityType: "ErasureRequest",
            entityId: request.Id,
            action: "Cancelled",
            actorUserId: command.CallerUserId,
            actorRole: request.OnBehalfOfUserId is null ? "data_principal" : "admin_security_responder",
            payload: new
            {
                requestId = request.Id,
                requestedAtUtc = request.RequestedAtUtc,
                cancelledAtUtc = nowUtc,
            },
            farmId: null,
            clientCommandId: null,
            appVersion: command.ClientAppVersion,
            deviceId: command.AuditDeviceId,
            ipHash: command.AuditIpHash), ct).ConfigureAwait(false);
        await repository.SaveChangesAsync(ct).ConfigureAwait(false);

        return Result.Success(new CancelErasureResult(request.Id, nameof(ErasureStatus.Cancelled), nowUtc));
    }
}
