using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Labour.GetLabourData;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Labour.GetFieldOperators;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 12) —
/// the field-operator read PATH proper. Replaces the direct-repo read Task
/// 11 wired straight into
/// <c>LabourEndpoints.MapGet("/farms/{farmId}/labour/field-operators")</c> as
/// its minimum authorized wiring ("Task 12 owns the field-operator read PATH
/// proper" — Task 11's own code comment). See
/// <see cref="GetFieldOperatorsQuery"/>'s file header for why this is never
/// unioned with <c>GetLabourDataHandler</c>'s People roster.
///
/// <para>
/// Returns the lean <see cref="FieldOperatorSummaryDto"/> projection
/// (Id/DisplayName/FullName/IsActive) — see that type's file header for why
/// it is a distinct shape from the write-side <see cref="FieldOperatorDto"/>.
/// </para>
/// <para>
/// Defense-in-depth membership re-check — mirrors
/// <c>GetLabourDataHandler</c>/<c>CreateFieldOperatorHandler</c>: the HTTP
/// entry point already gates via <c>ICallerFarmTenantScope</c>, but a
/// handler invoked from any other surface must still fail closed rather than
/// trust the caller.
/// </para>
/// </summary>
public sealed class GetFieldOperatorsHandler(IShramSafalRepository repository, IClock clock)
    : IHandler<GetFieldOperatorsQuery, IReadOnlyList<FieldOperatorSummaryDto>>
{
    public async Task<Result<IReadOnlyList<FieldOperatorSummaryDto>>> HandleAsync(
        GetFieldOperatorsQuery query, CancellationToken ct = default)
    {
        if (query.FarmId.IsEmpty || query.CallerUserId.IsEmpty)
        {
            return Result.Failure<IReadOnlyList<FieldOperatorSummaryDto>>(ShramSafalErrors.InvalidCommand);
        }

        var callerRole = await repository.GetUserRoleForFarmAsync(
            query.FarmId.Value, query.CallerUserId.Value, ct);
        if (callerRole is null)
        {
            return Result.Failure<IReadOnlyList<FieldOperatorSummaryDto>>(ShramSafalErrors.Forbidden);
        }

        // The roster is CREW data (names of every field operator on the farm),
        // not an own-row fact. Only the tiers whose register view already shows
        // crew — owners and Mukadam — or a member the owner explicitly GRANTED
        // labour management may read it; a plain Worker (and any other
        // own-row role) is refused with a READ Forbidden and no body.
        if (GetLabourDataHandler.ResolveRegisterView(callerRole.Value) == LabourRegisterView.OwnRow
            && !await LabourManagementGate.HasExplicitGrantAsync(
                repository, query.FarmId.Value, query.CallerUserId.Value, clock.UtcNow, ct))
        {
            return Result.Failure<IReadOnlyList<FieldOperatorSummaryDto>>(ShramSafalErrors.ReadNotAllowed);
        }

        var operators = await repository.GetFieldOperatorsForFarmAsync(query.FarmId, ct);

        IReadOnlyList<FieldOperatorSummaryDto> dtos = operators
            .Select(o => new FieldOperatorSummaryDto(o.Id, o.DisplayName, o.FullName, o.IsActive))
            .ToList();

        return Result.Success(dtos);
    }
}
