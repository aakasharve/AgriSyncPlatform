using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Labour.RenameFieldOperator;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 11) —
/// renames a <c>FieldOperator</c>.
///
/// <para>
/// Same RLS caveat as <c>AttachFieldOperatorHandler</c> applies here for the
/// single row this handler touches: <c>p_user_select_field_operators</c> is
/// a PERMISSIVE policy OR-ed with the tenant policy, so
/// <c>GetFieldOperatorByIdAsync</c> alone can return a row belonging to a
/// DIFFERENT farm under a multi-farm login. This handler asserts
/// <c>OriginatingFarmId == command.FarmId</c> explicitly before renaming —
/// never trusts "the repository returned a row" as authorization.
/// </para>
/// </summary>
public sealed class RenameFieldOperatorHandler(
    IShramSafalRepository repository,
    IClock clock)
    : IHandler<RenameFieldOperatorCommand, FieldOperatorDto>
{
    public async Task<Result<FieldOperatorDto>> HandleAsync(
        RenameFieldOperatorCommand command, CancellationToken ct = default)
    {
        if (command.FarmId.IsEmpty || command.FieldOperatorId == Guid.Empty
            || command.CallerUserId.IsEmpty || string.IsNullOrWhiteSpace(command.DisplayName))
        {
            return Result.Failure<FieldOperatorDto>(ShramSafalErrors.InvalidCommand);
        }

        var fieldOperator = await repository.GetFieldOperatorByIdAsync(command.FieldOperatorId, ct);
        if (fieldOperator is null || fieldOperator.OriginatingFarmId != command.FarmId)
        {
            // Deliberately Forbidden, never NotFound — same reasoning as
            // AttachFieldOperatorHandler: a distinct "not found" response
            // would let a forged id from another farm probe existence.
            return Result.Failure<FieldOperatorDto>(ShramSafalErrors.Forbidden);
        }

        try
        {
            fieldOperator.Rename(command.DisplayName, clock.UtcNow);
        }
        catch (ArgumentException)
        {
            return Result.Failure<FieldOperatorDto>(ShramSafalErrors.InvalidCommand);
        }

        await repository.SaveChangesAsync(ct);

        return Result.Success(fieldOperator.ToDto());
    }
}
