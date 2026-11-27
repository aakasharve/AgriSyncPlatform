using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Farms.FarmSetup;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Farms.SetMoneyPrivate;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM; founder 27 Nov follow-up 2: "पैशांच्या नोंदी फक्त मला दिसू दे")

/// <summary><c>farm.money_private.set</c>: turn the farm's money-private switch on or off.</summary>
public sealed record SetMoneyPrivateCommand(Guid FarmId, bool IsPrivate, FarmSetupCaller Caller);

/// <summary>The farm's money-private switch as it stands after the command.</summary>
public sealed record MoneyPrivateResult(Guid FarmId, bool IsPrivate);

/// <summary>
/// The door of the farm's money-private switch. "फक्त मला" is the farm's REGISTRANT (<c>farms.owner_user_id</c>), the record holder who always sees
/// every record (PRV fix pass 1, L2): only he may turn it; anyone else - a second PrimaryOwner seat, a सहमालक with every authority - is refused
/// <see cref="ShramSafalErrors.Forbidden"/> and nothing is written. The same value again is a success that writes nothing. A real change writes ONE
/// audit row <see cref="ChangedAction"/> (who, when, from, to) with the farm row, in one save. It moves no record already made (follow-up 1): a record
/// is stamped when it ARRIVES. Not behind any entitlement: it is a privacy control, not a paid feature.
/// </summary>
public sealed class SetMoneyPrivateHandler(IShramSafalRepository repository, IClock clock)
{
    public const string ChangedAction = "FarmMoneyPrivateChanged";

    public async Task<Result<MoneyPrivateResult>> HandleAsync(SetMoneyPrivateCommand command, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (command.FarmId == Guid.Empty || command.Caller is null || command.Caller.UserId == Guid.Empty)
        {
            return Result.Failure<MoneyPrivateResult>(ShramSafalErrors.InvalidCommand);
        }

        var farm = await repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure<MoneyPrivateResult>(ShramSafalErrors.FarmNotFound);
        }

        if (farm.OwnerUserId != new UserId(command.Caller.UserId))
        {
            return Result.Failure<MoneyPrivateResult>(ShramSafalErrors.Forbidden);
        }

        var from = farm.MoneyPrivateToHolder;
        if (!farm.SetMoneyPrivateToHolder(command.IsPrivate, clock.UtcNow))
        {
            return Result.Success(new MoneyPrivateResult(command.FarmId, farm.MoneyPrivateToHolder));
        }

        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "Farm",
                entityId: command.FarmId,
                action: ChangedAction,
                actorUserId: command.Caller.UserId,
                actorRole: "PrimaryOwner",
                payload: new { farmId = command.FarmId, from, to = farm.MoneyPrivateToHolder },
                farmId: command.FarmId,
                clientCommandId: command.Caller.ClientCommandId,
                appVersion: string.IsNullOrWhiteSpace(command.Caller.ClientAppVersion) ? "unknown" : command.Caller.ClientAppVersion,
                deviceId: string.IsNullOrWhiteSpace(command.Caller.AuditDeviceId) ? "unknown" : command.Caller.AuditDeviceId,
                ipHash: "sha256:unknown"),
            ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success(new MoneyPrivateResult(command.FarmId, farm.MoneyPrivateToHolder));
    }
}
