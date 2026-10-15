using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Labour.DeactivateFieldOperator;

/// <summary>
/// spec: 2026-08-25-prod-cutover-waves (Team actions) — "Remove" for a NAMED worker.
///
/// <para>
/// Sets <c>FieldOperator.IsActive = false</c> through the entity's existing
/// <c>Deactivate</c> and nothing else. The pickers already filter on
/// <c>IsActive</c>, so he is no longer offered for NEW marks, while the roster
/// read, the हजेरी register and every historical mark keep resolving his name:
/// no row is deleted, no attribution rewritten, no headcount touched.
/// </para>
/// <para>
/// Authority is the SHARED labour predicate (<see cref="LabourManagementGate"/>) —
/// the identical rule <c>CreateFieldOperatorHandler</c> and
/// <c>RenameFieldOperatorHandler</c> apply, and the one <c>canManageLabour</c>
/// reports to the client. Not broadened. Idempotent: retiring an already-retired
/// person is a success. An unknown id and another farm's id are both
/// <c>Forbidden</c> (the by-id lookup is not farm-scoped — PERMISSIVE select
/// policy — so <c>OriginatingFarmId</c> is asserted explicitly, and no existence
/// can be probed).
/// </para>
/// </summary>
public sealed class DeactivateFieldOperatorHandler(
    IShramSafalRepository repository,
    IClock clock)
    : IHandler<DeactivateFieldOperatorCommand, FieldOperatorDto>
{
    public async Task<Result<FieldOperatorDto>> HandleAsync(
        DeactivateFieldOperatorCommand command, CancellationToken ct = default)
    {
        if (command.FarmId.IsEmpty || command.FieldOperatorId == Guid.Empty || command.CallerUserId.IsEmpty)
        {
            return Result.Failure<FieldOperatorDto>(ShramSafalErrors.InvalidCommand);
        }

        if (!await LabourManagementGate.IsAllowedAsync(
                repository, command.FarmId.Value, command.CallerUserId.Value, clock.UtcNow, ct))
        {
            return Result.Failure<FieldOperatorDto>(ShramSafalErrors.Forbidden);
        }

        var fieldOperator = await repository.GetFieldOperatorByIdAsync(command.FieldOperatorId, ct);
        if (fieldOperator is null || fieldOperator.OriginatingFarmId != command.FarmId)
        {
            return Result.Failure<FieldOperatorDto>(ShramSafalErrors.Forbidden);
        }

        if (fieldOperator.IsActive)
        {
            fieldOperator.Deactivate(clock.UtcNow);
            await repository.SaveChangesAsync(ct);
        }

        return Result.Success(fieldOperator.ToDto());
    }
}
