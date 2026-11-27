using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Farms.FarmSetup;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Farms.SetOwnBillApproval;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-177; founder 27 Nov B1.4: "an owner switch for each farm; off unless the owner turns it on")

/// <summary><c>farm.own_bill_approval.set</c>: turn the farm's own-bill switch on or off.</summary>
public sealed record SetOwnBillApprovalCommand(Guid FarmId, bool Allowed, FarmSetupCaller Caller);

/// <summary>The farm's own-bill switch as it stands after the command.</summary>
public sealed record OwnBillApprovalResult(Guid FarmId, bool Allowed);

/// <summary>
/// The door of the farm's own-bill switch: may a person who checks money approve a bill he made himself. ONLY the farm's primary account holder may turn
/// it (people and permissions are his alone, D-26); anyone else, whatever authority his seat holds, is refused <see cref="ShramSafalErrors.Forbidden"/>
/// and nothing is written. The same value again is a success that writes nothing. A real change writes ONE audit row (who, when, old, new) with the
/// farm row, in one save. Not behind any entitlement: it is a rule about money already recorded, like the approval itself.
/// </summary>
public sealed class SetOwnBillApprovalHandler(IShramSafalRepository repository, IClock clock)
{
    public const string SwitchSetAction = "OwnBillApprovalSwitchSet";

    public async Task<Result<OwnBillApprovalResult>> HandleAsync(SetOwnBillApprovalCommand command, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (command.FarmId == Guid.Empty || command.Caller is null || command.Caller.UserId == Guid.Empty)
        {
            return Result.Failure<OwnBillApprovalResult>(ShramSafalErrors.InvalidCommand);
        }

        var farm = await repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure<OwnBillApprovalResult>(ShramSafalErrors.FarmNotFound);
        }

        if (!await FarmAuthorityGate.IsPrimaryAccountHolderAsync(repository, command.FarmId, command.Caller.UserId, ct))
        {
            return Result.Failure<OwnBillApprovalResult>(ShramSafalErrors.Forbidden);
        }

        var old = farm.ReviewerMayApproveOwnBill;
        if (!farm.SetReviewerMayApproveOwnBill(command.Allowed, clock.UtcNow))
        {
            return Result.Success(new OwnBillApprovalResult(command.FarmId, farm.ReviewerMayApproveOwnBill));
        }

        var role = await repository.GetUserRoleForFarmAsync(command.FarmId, command.Caller.UserId, ct);
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "Farm",
                entityId: command.FarmId,
                action: SwitchSetAction,
                actorUserId: command.Caller.UserId,
                actorRole: role?.ToString() ?? "PrimaryOwner",
                payload: new { farmId = command.FarmId, old, @new = farm.ReviewerMayApproveOwnBill },
                farmId: command.FarmId,
                clientCommandId: command.Caller.ClientCommandId,
                appVersion: string.IsNullOrWhiteSpace(command.Caller.ClientAppVersion) ? "unknown" : command.Caller.ClientAppVersion,
                deviceId: string.IsNullOrWhiteSpace(command.Caller.AuditDeviceId) ? "unknown" : command.Caller.AuditDeviceId,
                ipHash: "sha256:unknown"),
            ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success(new OwnBillApprovalResult(command.FarmId, farm.ReviewerMayApproveOwnBill));
    }
}
