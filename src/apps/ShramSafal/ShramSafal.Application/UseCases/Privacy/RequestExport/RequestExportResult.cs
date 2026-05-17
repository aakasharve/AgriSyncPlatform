// spec: data-principle-spine-2026-05-05/08.3
namespace ShramSafal.Application.UseCases.Privacy.RequestExport;

public sealed record RequestExportResult(
    Guid RequestId,
    DateTime RequestedAtUtc);
