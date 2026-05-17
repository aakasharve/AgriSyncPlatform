// spec: data-principle-spine-2026-05-05/08.3
namespace ShramSafal.Application.UseCases.Privacy.RequestExport;

public sealed record RequestExportCommand(
    Guid RequestedByUserId,
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
