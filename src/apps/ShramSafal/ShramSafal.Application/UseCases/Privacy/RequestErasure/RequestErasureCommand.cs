// spec: data-principle-spine-2026-05-05/08.2
namespace ShramSafal.Application.UseCases.Privacy.RequestErasure;

public sealed record RequestErasureCommand(
    Guid RequestedByUserId,
    Guid? OnBehalfOfUserId,
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
