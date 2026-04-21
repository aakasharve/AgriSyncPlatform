using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;

namespace ShramSafal.Application.UseCases.Compliance.ResolveSignal;

/// <summary>
/// CEI Phase 3 §4.6 — resolves a compliance signal with a required note (min 3 chars).
/// Allowed roles: PrimaryOwner | SecondaryOwner | Agronomist | Consultant | FpcTechnicalManager.
/// </summary>
public sealed record ResolveSignalCommand(
    Guid SignalId,
    UserId CallerUserId,
    AppRole CallerRole,
    string Note);
