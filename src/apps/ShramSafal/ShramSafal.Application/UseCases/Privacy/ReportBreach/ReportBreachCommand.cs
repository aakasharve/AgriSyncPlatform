// spec: data-principle-spine-2026-05-05/08.5
//
// Sub-phase 08.5 (per OQ-5 scaffolding verdict) — admin-only command to
// register a breach incident. Phase 08 scaffolds the table + endpoint
// + LRP-tagged templates; the actual notification dispatch wires up in
// Phase 12+.

using ShramSafal.Domain.Privacy;

namespace ShramSafal.Application.UseCases.Privacy.ReportBreach;

public sealed record ReportBreachCommand(
    Guid ReporterUserId,
    BreachSeverity Severity,
    string ScopeDescription,
    int AffectedUserCount,
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
