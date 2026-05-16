using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Compliance.EvaluateCompliance;

/// <summary>
/// CEI Phase 3 §4.6 — triggers a full compliance evaluation for a single farm.
/// Idempotent: calling multiple times produces at most one open signal per rule key.
/// <para>
/// Has two call paths: (a) HTTP <c>POST /compliance/evaluate/{farmId}</c> via
/// <see cref="ComplianceEndpoints"/> with real <c>X-Device-Id</c> / IP hash,
/// (b) cron via <see cref="AgriSync.Bootstrapper.Jobs.ComplianceEvaluatorSweeper"/>
/// which passes the worker sentinel pair <c>("worker", "sha256:worker")</c>.
/// Audit rows emitted by this handler inherit the provenance pair from the
/// command — no in-handler fallback needed (Sub-commit D §Part 2 Option B).
/// </para>
/// </summary>
public sealed record EvaluateComplianceCommand(
    FarmId FarmId,
    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance fields
    // sourced from either HttpContext.AuditClaims() (HTTP path) or
    // AuditContextAccessor.WorkerClaims() (cron path). Defaults match the
    // worker / unknown sentinel so direct-construction unit tests stay green.
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");

public sealed record EvaluateComplianceResult(int Opened, int Refreshed, int AutoResolved);
