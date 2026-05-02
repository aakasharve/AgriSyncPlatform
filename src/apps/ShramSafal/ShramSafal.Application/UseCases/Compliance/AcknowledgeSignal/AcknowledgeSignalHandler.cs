using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Compliance.AcknowledgeSignal;

/// <summary>
/// CEI Phase 3 §4.6 — acknowledges an open compliance signal.
/// Allowed roles: Mukadam and above (value >= 1).
/// </summary>
public sealed class AcknowledgeSignalHandler(
    IComplianceSignalRepository signalRepository,
    IShramSafalRepository repository,
    IClock clock) : IHandler<AcknowledgeSignalCommand>
{
    // Mukadam (1) and all higher roles may acknowledge
    private static readonly HashSet<AppRole> AllowedRoles =
    [
        AppRole.Mukadam,
        AppRole.SecondaryOwner,
        AppRole.PrimaryOwner,
        AppRole.Agronomist,
        AppRole.Consultant,
        AppRole.FpcTechnicalManager
    ];

    public async Task<Result> HandleAsync(AcknowledgeSignalCommand command, CancellationToken ct = default)
    {
        if (command is null || command.SignalId == Guid.Empty || command.CallerUserId.IsEmpty)
            return Result.Failure(ShramSafalErrors.InvalidCommand);

        if (!AllowedRoles.Contains(command.CallerRole))
            return Result.Failure(ShramSafalErrors.ComplianceSignalRoleNotAllowed);

        var signal = await signalRepository.GetByIdAsync(command.SignalId, ct);
        if (signal is null)
            return Result.Failure(ShramSafalErrors.ComplianceSignalNotFound);

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

        var audit = AuditEvent.Create(
            farmId: (Guid?)((Guid)signal.FarmId),
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
            occurredAtUtc: now);

        await repository.AddAuditEventAsync(audit);
        await repository.SaveChangesAsync(ct);

        return Result.Success();
    }
}
