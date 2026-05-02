using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Application.UseCases.Tests.WaiveTestInstance;

/// <summary>
/// Handler for <see cref="WaiveTestInstanceCommand"/>. Role-gates the call,
/// delegates to <see cref="TestInstance.Waive"/>, persists, and emits an
/// <see cref="AuditEvent"/> with action <c>test.waived</c>. See CEI §4.5.
/// </summary>
public sealed class WaiveTestInstanceHandler(
    ITestInstanceRepository testInstanceRepository,
    IShramSafalRepository repository,
    IClock clock) : IHandler<WaiveTestInstanceCommand>
{
    private static readonly HashSet<AppRole> AllowedRoles =
    [
        AppRole.PrimaryOwner,
        AppRole.Agronomist
    ];

    public async Task<Result> HandleAsync(
        WaiveTestInstanceCommand command,
        CancellationToken ct = default)
    {
        if (command is null ||
            command.TestInstanceId == Guid.Empty ||
            command.CallerUserId.IsEmpty ||
            string.IsNullOrWhiteSpace(command.Reason))
        {
            return Result.Failure(ShramSafalErrors.InvalidCommand);
        }

        if (!AllowedRoles.Contains(command.CallerRole))
        {
            return Result.Failure(ShramSafalErrors.TestRoleNotAllowed);
        }

        var instance = await testInstanceRepository.GetByIdAsync(command.TestInstanceId, ct);
        if (instance is null)
        {
            return Result.Failure(ShramSafalErrors.TestInstanceNotFound);
        }

        var now = clock.UtcNow;

        try
        {
            instance.Waive(command.CallerUserId, command.CallerRole, command.Reason, now);
        }
        catch (InvalidOperationException)
        {
            return Result.Failure(ShramSafalErrors.TestInvalidState);
        }
        catch (ArgumentException)
        {
            return Result.Failure(ShramSafalErrors.InvalidCommand);
        }

        await testInstanceRepository.SaveChangesAsync(ct);

        var audit = AuditEvent.Create(
            farmId: instance.FarmId.Value,
            entityType: "TestInstance",
            entityId: instance.Id,
            action: "test.waived",
            actorUserId: command.CallerUserId.Value,
            actorRole: command.CallerRole.ToString().ToLowerInvariant(),
            payload: new
            {
                testInstanceId = instance.Id,
                cropCycleId = instance.CropCycleId,
                plotId = instance.PlotId,
                stageName = instance.StageName,
                reason = instance.WaivedReason,
                waivedAtUtc = instance.WaivedAtUtc
            },
            occurredAtUtc: now);

        await repository.AddAuditEventAsync(audit, ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success();
    }
}
