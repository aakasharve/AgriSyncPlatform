using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;

namespace ShramSafal.Application.UseCases.Compliance.AcknowledgeSignal;

/// <summary>
/// CEI Phase 3 §4.6 — acknowledges a compliance signal.
/// Allowed roles: Mukadam and above.
/// </summary>
public sealed record AcknowledgeSignalCommand(
    Guid SignalId,
    UserId CallerUserId,
    AppRole CallerRole);
