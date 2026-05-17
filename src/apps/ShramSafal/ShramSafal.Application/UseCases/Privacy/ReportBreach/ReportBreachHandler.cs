// spec: data-principle-spine-2026-05-05/08.5
//
// Sub-phase 08.5 (per OQ-5 scaffolding verdict) — admin records a
// breach incident. NO notification dispatch wired (Phase 12+); the
// handler logs "notification dispatch deferred to Phase 12+" and emits
// an AuditEvent (entityType="BreachIncident" action="Reported").
//
// The handler uses the IAdminDbContextFactory<ShramSafalDbContext> via
// the IShramSafalRepository surface (mirrors UpdateConsentHandler's
// shape — handler stays in Application, the admin-elevated context is
// resolved by the underlying repository implementation). For the
// breach incident shape we don't need cross-tenant reads, so a normal
// repository write suffices.

using AgriSync.BuildingBlocks.Results;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Privacy;

namespace ShramSafal.Application.UseCases.Privacy.ReportBreach;

public sealed class ReportBreachHandler(
    IShramSafalRepository repository,
    TimeProvider clock,
    ILogger<ReportBreachHandler> logger)
{
    public async Task<Result<ReportBreachResult>> HandleAsync(
        ReportBreachCommand command,
        CancellationToken ct = default)
    {
        if (command.ReporterUserId == Guid.Empty)
        {
            return Result.Failure<ReportBreachResult>(ShramSafalErrors.JoinUnauthenticated);
        }
        if (string.IsNullOrWhiteSpace(command.ScopeDescription))
        {
            return Result.Failure<ReportBreachResult>(ShramSafalErrors.InvalidCommand);
        }

        var nowUtc = clock.GetUtcNow().UtcDateTime;

        var incident = BreachIncident.Report(
            severity: command.Severity,
            scopeDescription: command.ScopeDescription,
            affectedUserCount: command.AffectedUserCount,
            detectedAt: nowUtc);

        await repository.AddBreachIncidentAsync(incident, ct).ConfigureAwait(false);

        var auditEvent = AuditEventFactory.Create(
            entityType: "BreachIncident",
            entityId: incident.Id,
            action: "Reported",
            actorUserId: command.ReporterUserId,
            actorRole: "admin_security_responder",
            payload: new
            {
                incidentId = incident.Id,
                severity = command.Severity.ToString(),
                affectedUserCount = command.AffectedUserCount,
                scopeDescription = command.ScopeDescription,
            },
            farmId: null,
            clientCommandId: null,
            appVersion: command.ClientAppVersion,
            deviceId: command.AuditDeviceId,
            ipHash: command.AuditIpHash);

        await repository.AddAuditEventAsync(auditEvent, ct).ConfigureAwait(false);

        await repository.SaveChangesAsync(ct).ConfigureAwait(false);

        // OQ-5 scaffolding verdict: no SendGrid wire — log the deferral
        // explicitly so an operator scanning the logs sees the gap.
        logger.LogWarning(
            "BreachIncident {IncidentId} recorded (severity={Severity}, affected={AffectedUserCount}). "
            + "Notification dispatch deferred to Phase 12+.",
            incident.Id, command.Severity, command.AffectedUserCount);

        return Result.Success(new ReportBreachResult(
            IncidentId: incident.Id,
            DetectedAtUtc: incident.DetectedAt));
    }
}
