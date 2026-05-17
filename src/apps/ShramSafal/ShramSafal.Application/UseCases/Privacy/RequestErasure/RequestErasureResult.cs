// spec: data-principle-spine-2026-05-05/08.2
namespace ShramSafal.Application.UseCases.Privacy.RequestErasure;

public sealed record RequestErasureResult(
    Guid RequestId,
    DateTime RequestedAtUtc);
