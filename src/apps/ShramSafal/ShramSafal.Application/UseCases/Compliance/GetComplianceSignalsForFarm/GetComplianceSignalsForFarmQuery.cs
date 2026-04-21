using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Compliance.GetComplianceSignalsForFarm;

/// <summary>
/// CEI Phase 3 §4.6 — returns compliance signals for a farm, ordered by severity
/// descending (Critical first) then LastSeenAtUtc descending.
/// </summary>
public sealed record GetComplianceSignalsForFarmQuery(
    FarmId FarmId,
    bool IncludeResolved = false,
    bool IncludeAcknowledged = false);
