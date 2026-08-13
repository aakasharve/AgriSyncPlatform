using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Labour;

namespace ShramSafal.Application.UseCases.Labour.CreateFieldOperator;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 11) —
/// mints a new <see cref="FieldOperator"/> work identity on the farm
/// established by <c>ICallerFarmTenantScope</c> for this request.
/// </summary>
public sealed class CreateFieldOperatorHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock)
    : IHandler<CreateFieldOperatorCommand, FieldOperatorDto>
{
    public async Task<Result<FieldOperatorDto>> HandleAsync(
        CreateFieldOperatorCommand command, CancellationToken ct = default)
    {
        if (command.FarmId.IsEmpty || command.CallerUserId.IsEmpty
            || string.IsNullOrWhiteSpace(command.DisplayName))
        {
            return Result.Failure<FieldOperatorDto>(ShramSafalErrors.InvalidCommand);
        }

        // LABOUR_PHASE2 Phase 5 — the SHARED labour predicate, not a membership
        // check. This used to be `callerRole is null`, i.e. ANY member could
        // mint a work identity, a Worker included. Founder decision O-4 makes
        // the five governed labour actions obey one rule: owner-tier always,
        // Mukadam by default, any other role only when explicitly granted. The
        // gate still fails closed for a non-member, so the defense-in-depth
        // property this line originally had (the HTTP entry point gates via
        // ICallerFarmTenantScope, but a handler invoked from any other surface
        // must stand on its own) is preserved, not replaced.
        if (!await LabourManagementGate.IsAllowedAsync(
                repository, command.FarmId.Value, command.CallerUserId.Value, ct))
        {
            return Result.Failure<FieldOperatorDto>(ShramSafalErrors.Forbidden);
        }

        FieldOperator operatorEntity;
        try
        {
            operatorEntity = FieldOperator.Create(
                idGenerator.New(),
                command.DisplayName,
                command.FullName,
                // 11.3 — OriginatingFarmId is command.FarmId (the farm
                // ICallerFarmTenantScope established for THIS request),
                // never "the caller's farm": a caller may own or belong to
                // several farms, so there is no single "the caller's farm".
                command.FarmId,
                command.CallerUserId,
                clock.UtcNow);
        }
        catch (ArgumentException)
        {
            return Result.Failure<FieldOperatorDto>(ShramSafalErrors.InvalidCommand);
        }

        await repository.AddFieldOperatorAsync(operatorEntity, ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success(operatorEntity.ToDto());
    }
}
