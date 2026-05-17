// spec: data-principle-spine-2026-05-05/08.5
namespace ShramSafal.Application.UseCases.Privacy.ReportBreach;

public sealed record ReportBreachResult(
    Guid IncidentId,
    DateTime DetectedAtUtc);
