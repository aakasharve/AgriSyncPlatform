using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Tests;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Farms;

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

        var instance = await testInstanceRepository.GetByIdAsync(command.TestInstanceId, ct);
        if (instance is null)
        {
            return Result.Failure(ShramSafalErrors.TestInstanceNotFound);
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
            return Result.Failure(ShramSafalErrors.TestRoleNotAllowed);
        }

        // spec: plr-d10 lane MU-4 fix pass 1 (H1) — a seat on chosen plots writes only on his plots (REST and sync alike).
        if (await PlotScopeGate.RefuseAsync(
                repository, instance.FarmId.Value, instance.PlotId, command.CallerUserId.Value, clock.UtcNow, ct) is { } outsidePlots)
        {
            return Result.Failure(outsidePlots);
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

        // DATA_PRINCIPLE_SPINE sub-phase 04.3b — migrate from AuditEvent.Create
        // (sentinel provenance) to AuditEventFactory.Create with the real
        // X-Device-Id / IP hash / X-App-Version sourced from the endpoint's
        // AuditContextAccessor.
        var audit = AuditEventFactory.Create(
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
            farmId: instance.FarmId.Value,
            clientCommandId: null,
            appVersion: command.ClientAppVersion,
            deviceId: command.AuditDeviceId,
            ipHash: command.AuditIpHash,
            sourceAiJobId: null);

        await repository.AddAuditEventAsync(audit, ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success();
    }
}
