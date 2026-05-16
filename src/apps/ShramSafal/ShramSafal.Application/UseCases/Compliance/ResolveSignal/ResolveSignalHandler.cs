using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Compliance.ResolveSignal;

/// <summary>
/// CEI Phase 3 §4.6 — resolves an open compliance signal with a required note.
/// Allowed roles: PrimaryOwner, SecondaryOwner, Agronomist, Consultant, FpcTechnicalManager.
/// </summary>
public sealed class ResolveSignalHandler(
    IComplianceSignalRepository signalRepository,
    IShramSafalRepository repository,
    IClock clock) : IHandler<ResolveSignalCommand>
{
    private static readonly HashSet<AppRole> AllowedRoles =
    [
        AppRole.PrimaryOwner,
        AppRole.SecondaryOwner,
        AppRole.Agronomist,
        AppRole.Consultant,
        AppRole.FpcTechnicalManager
    ];

    public async Task<Result> HandleAsync(ResolveSignalCommand command, CancellationToken ct = default)
    {
        if (command is null || command.SignalId == Guid.Empty || command.CallerUserId.IsEmpty)
            return Result.Failure(ShramSafalErrors.InvalidCommand);

        if (string.IsNullOrWhiteSpace(command.Note) || command.Note.Trim().Length < 3)
            return Result.Failure(ShramSafalErrors.ComplianceSignalNoteRequired);

        if (!AllowedRoles.Contains(command.CallerRole))
            return Result.Failure(ShramSafalErrors.ComplianceSignalRoleNotAllowed);

        var signal = await signalRepository.GetByIdAsync(command.SignalId, ct);
        if (signal is null)
            return Result.Failure(ShramSafalErrors.ComplianceSignalNotFound);

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
