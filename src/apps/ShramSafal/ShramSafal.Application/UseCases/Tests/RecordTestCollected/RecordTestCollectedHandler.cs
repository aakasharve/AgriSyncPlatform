using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Application.UseCases.Tests.RecordTestCollected;

/// <summary>
/// Handler for <see cref="RecordTestCollectedCommand"/>. Role-gates the call,
/// delegates to <see cref="TestInstance.MarkCollected"/>, persists, and emits
/// an <see cref="AuditEvent"/> with action <c>test.collected</c>.
/// </summary>
public sealed class RecordTestCollectedHandler(
    ITestInstanceRepository testInstanceRepository,
    ITestProtocolRepository testProtocolRepository,
    IShramSafalRepository repository,
    IClock clock)
{
    private static readonly HashSet<AppRole> AllowedRoles =
    [
        AppRole.LabOperator,
        AppRole.SecondaryOwner,
        AppRole.Mukadam
    ];

    public async Task<Result<TestInstanceDto>> HandleAsync(
        RecordTestCollectedCommand command,
        CancellationToken ct = default)
    {
        if (command is null ||
            command.TestInstanceId == Guid.Empty ||
            command.CallerUserId.IsEmpty)
        {
            return Result.Failure<TestInstanceDto>(ShramSafalErrors.InvalidCommand);
        }

        if (!AllowedRoles.Contains(command.CallerRole))
        {
            return Result.Failure<TestInstanceDto>(ShramSafalErrors.TestRoleNotAllowed);
        }

        var instance = await testInstanceRepository.GetByIdAsync(command.TestInstanceId, ct);
        if (instance is null)
        {
            return Result.Failure<TestInstanceDto>(ShramSafalErrors.TestInstanceNotFound);
        }

        var now = clock.UtcNow;

        try
        {
            instance.MarkCollected(command.CallerUserId, command.CallerRole, now);
        }
        catch (InvalidOperationException)
        {
            return Result.Failure<TestInstanceDto>(ShramSafalErrors.TestInvalidState);
        }

        await testInstanceRepository.SaveChangesAsync(ct);

        var audit = AuditEvent.Create(
            farmId: instance.FarmId.Value,
            entityType: "TestInstance",
            entityId: instance.Id,
            action: "test.collected",
            actorUserId: command.CallerUserId.Value,
            actorRole: command.CallerRole.ToString().ToLowerInvariant(),
            payload: new
            {
                testInstanceId = instance.Id,
                cropCycleId = instance.CropCycleId,
                plotId = instance.PlotId,
                stageName = instance.StageName,
                collectedAtUtc = instance.CollectedAtUtc
            },
            occurredAtUtc: now);

        await repository.AddAuditEventAsync(audit, ct);
        await repository.SaveChangesAsync(ct);

        var protocol = await testProtocolRepository.GetByIdAsync(instance.TestProtocolId, ct);
        return Result.Success(TestInstanceDto.FromDomain(instance, protocol?.Name));
    }
}
