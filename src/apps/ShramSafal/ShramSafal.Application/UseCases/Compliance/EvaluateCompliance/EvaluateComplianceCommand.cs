using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Compliance.EvaluateCompliance;

/// <summary>
/// CEI Phase 3 §4.6 — triggers a full compliance evaluation for a single farm.
/// Idempotent: calling multiple times produces at most one open signal per rule key.
/// </summary>
public sealed record EvaluateComplianceCommand(FarmId FarmId);

public sealed record EvaluateComplianceResult(int Opened, int Refreshed, int AutoResolved);
