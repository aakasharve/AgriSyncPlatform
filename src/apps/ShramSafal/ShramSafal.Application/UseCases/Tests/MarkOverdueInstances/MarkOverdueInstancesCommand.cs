namespace ShramSafal.Application.UseCases.Tests.MarkOverdueInstances;

/// <summary>
/// Sweeper command — transitions every <see cref="ShramSafal.Domain.Tests.TestInstance"/>
/// in <c>Due</c> state with <c>PlannedDueDate &lt; today</c> to <c>Overdue</c>.
///
/// Invoked by the <c>TestOverdueSweeper</c> background service at 02:00 UTC daily.
/// Returns the number of instances that were transitioned. See CEI §4.5.
/// <para>
/// Pure cron path — has no HttpContext. The caller (TestOverdueSweeper)
/// constructs the command with the worker sentinel pair from
/// <see cref="AgriSync.BuildingBlocks.Audit.AuditContextAccessor.WorkerClaims"/>
/// (<c>"worker"</c> / <c>"sha256:worker"</c>) so every emitted AuditEvent
/// inherits identifiable provenance. Sub-commit D §Part 2 Option B.
/// </para>
/// </summary>
public sealed record MarkOverdueInstancesCommand(
    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance fields.
    // Defaults match the unknown sentinel so direct-construction unit tests
    // (no HttpContext, no scheduler) stay green; production cron path passes
    // ("worker", "sha256:worker") explicitly via the TestOverdueSweeper.
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
