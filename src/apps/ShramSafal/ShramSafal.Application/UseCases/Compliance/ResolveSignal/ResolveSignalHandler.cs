using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Compliance.ResolveSignal;

/// <summary>
/// CEI Phase 3 §4.6 — resolves an open compliance signal with a required note.
/// lane 2b: allowed to the confirm-records authority of the signal's farm seat.
/// </summary>
public sealed class ResolveSignalHandler(
    IComplianceSignalRepository signalRepository,
    IShramSafalRepository repository,
    IClock clock) : IHandler<ResolveSignalCommand>
{
    public async Task<Result> HandleAsync(ResolveSignalCommand command, CancellationToken ct = default)
    {
        if (command is null || command.SignalId == Guid.Empty || command.CallerUserId.IsEmpty)
            return Result.Failure(ShramSafalErrors.InvalidCommand);

        if (string.IsNullOrWhiteSpace(command.Note) || command.Note.Trim().Length < 3)
            return Result.Failure(ShramSafalErrors.ComplianceSignalNoteRequired);

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

        // spec: plr-d10 lane PRV fix pass 1 (H2) — a warning that names a record kept from him is not his to handle.
        if ((await RecordVisibility.ForFarmAsync(repository, signal.FarmId.Value, command.CallerUserId.Value, clock.UtcNow, ct))
            .MentionsHidden(signal.PayloadJson))
            return Result.Failure(ShramSafalErrors.RecordAudienceClosed);

        var now = clock.UtcNow;

        try
        {
            signal.Resolve(command.CallerUserId, command.Note, now);
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
            action: "compliance.resolved",
            actorUserId: (Guid)command.CallerUserId,
            actorRole: command.CallerRole.ToString().ToLowerInvariant(),
            payload: new
            {
                signalId = signal.Id,
                ruleCode = signal.RuleCode,
                note = signal.ResolutionNote,
                resolvedAtUtc = signal.ResolvedAtUtc
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
