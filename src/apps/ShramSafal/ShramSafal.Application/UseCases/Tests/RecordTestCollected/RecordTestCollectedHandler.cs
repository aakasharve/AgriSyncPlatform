using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Tests;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Farms;

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

        var instance = await testInstanceRepository.GetByIdAsync(command.TestInstanceId, ct);
        if (instance is null)
        {
            return Result.Failure<TestInstanceDto>(ShramSafalErrors.TestInstanceNotFound);
        }

        // lane 2b (founder D-22 / D-26; D-20) — lab records is an authority of the caller's seat on
        // THIS test's farm (the primary account holder always), never the account's global role:
        // the role list that stood here refused the farm's own owner and admitted any account
        // whose sign-up role matched, on any farm. Checked after the read so the farm is known;
        // a test on a farm the caller cannot see is NotFound under its own row policy.
        if (!await FarmAuthorityGate.HoldsAsync(
                repository, instance.FarmId.Value, command.CallerUserId.Value, FarmAuthority.LabRecords,
                clock.UtcNow, ct))
        {
            return Result.Failure<TestInstanceDto>(ShramSafalErrors.TestRoleNotAllowed);
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

        // DATA_PRINCIPLE_SPINE sub-phase 04.3b — migrate from AuditEvent.Create
        // (sentinel provenance) to AuditEventFactory.Create with the real
        // X-Device-Id / IP hash / X-App-Version sourced from the endpoint's
        // AuditContextAccessor.
        var audit = AuditEventFactory.Create(
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
            farmId: instance.FarmId.Value,
            clientCommandId: null,
            appVersion: command.ClientAppVersion,
            deviceId: command.AuditDeviceId,
            ipHash: command.AuditIpHash,
            sourceAiJobId: null);

        await repository.AddAuditEventAsync(audit, ct);
        await repository.SaveChangesAsync(ct);

        var protocol = await testProtocolRepository.GetByIdAsync(instance.TestProtocolId, ct);
        return Result.Success(TestInstanceDto.FromDomain(instance, protocol?.Name));
    }
}
