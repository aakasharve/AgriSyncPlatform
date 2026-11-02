using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Compliance.AcknowledgeSignal;

/// <summary>
/// CEI Phase 3 §4.6 — acknowledges an open compliance signal.
/// lane 2b: allowed to the confirm-records authority of the signal's farm seat.
/// </summary>
public sealed class AcknowledgeSignalHandler(
    IComplianceSignalRepository signalRepository,
    IShramSafalRepository repository,
    IClock clock) : IHandler<AcknowledgeSignalCommand>
{
    public async Task<Result> HandleAsync(AcknowledgeSignalCommand command, CancellationToken ct = default)
    {
        if (command is null || command.SignalId == Guid.Empty || command.CallerUserId.IsEmpty)
            return Result.Failure(ShramSafalErrors.InvalidCommand);

        var signal = await signalRepository.GetByIdAsync(command.SignalId, ct);
        if (signal is null)
            return Result.Failure(ShramSafalErrors.ComplianceSignalNotFound);

        // lane 2b (founder D-26; MU design §2, §11.1) — handling a compliance warning is reviewing the
        // farm's records: the confirm-records authority of the caller's seat on THIS signal's farm
        // (the primary account holder always). The account's global role used to decide this — any
        // account whose sign-up role matched, on any farm whose row it could read; it decides nothing
        // now. The refusal keeps its old code, which every installed phone parks visibly.
        if (!await FarmAuthorityGate.HoldsAsync(
                repository, signal.FarmId.Value, command.CallerUserId.Value, FarmAuthority.ConfirmRecords,
                clock.UtcNow, ct))
            return Result.Failure(ShramSafalErrors.ComplianceSignalRoleNotAllowed);

        // spec: plr-d10 lane MU-4 fix pass 1 (H1) — a seat on chosen plots writes only on his plots (REST and sync alike): the
        //    sync payload names only the warning, so the warning's own plot is asked here.
        if (await PlotScopeGate.RefuseAsync(
                repository, signal.FarmId.Value, signal.PlotId, command.CallerUserId.Value, clock.UtcNow, ct) is { } outsidePlots)
            return Result.Failure(outsidePlots);

        // spec: plr-d10 lane PRV fix pass 1 (H2) — a warning that names a record kept from him is not his to handle.
        if ((await RecordVisibility.ForFarmAsync(repository, signal.FarmId.Value, command.CallerUserId.Value, clock.UtcNow, ct))
            .MentionsHidden(signal.PayloadJson))
            return Result.Failure(ShramSafalErrors.RecordAudienceClosed);

        var now = clock.UtcNow;

        try
        {
            signal.Acknowledge(command.CallerUserId, now);
        }
        catch (InvalidOperationException)
        {
            return Result.Failure(ShramSafalErrors.ComplianceSignalInvalidState);
        }

        await signalRepository.SaveChangesAsync(ct);

        // DATA_PRINCIPLE_SPINE sub-phase 04.3b — migrate from AuditEvent.Create
        // (sentinel provenance) to AuditEventFactory.Create with the real
        // X-Device-Id / IP hash / X-App-Version sourced from the endpoint's
        // AuditContextAccessor.
        var audit = AuditEventFactory.Create(
            entityType: "ComplianceSignal",
            entityId: signal.Id,
            action: "compliance.acknowledged",
            actorUserId: (Guid)command.CallerUserId,
            actorRole: command.CallerRole.ToString().ToLowerInvariant(),
            payload: new
            {
                signalId = signal.Id,
                ruleCode = signal.RuleCode,
                acknowledgedAtUtc = signal.AcknowledgedAtUtc
            },
            farmId: (Guid)signal.FarmId,
            clientCommandId: null,
            appVersion: command.ClientAppVersion,
            deviceId: command.AuditDeviceId,
            ipHash: command.AuditIpHash,
            sourceAiJobId: null);

        await repository.AddAuditEventAsync(audit);
        await repository.SaveChangesAsync(ct);

        return Result.Success();
    }
}
