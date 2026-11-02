// spec: data-principle-spine-2026-05-05/08.2
namespace ShramSafal.Application.UseCases.Privacy.RequestErasure;

/// <summary>
/// The 202 answer. lane F99 fix pass 1, item 11 (D-71) ADDS <see cref="ErasureStartsAtUtc"/> and <see cref="Status"/>: an
/// installed 1.0.17 reads only <c>requestId</c> and ignores the rest (P11). Fix pass 2 (N-1) adds
/// <see cref="AlreadyWaiting"/>: true when this person already had a waiting request, which is the one answered.
/// </summary>
public sealed record RequestErasureResult(
    Guid RequestId,
    DateTime RequestedAtUtc,
    DateTime ErasureStartsAtUtc,
    string Status = "Requested",
    bool AlreadyWaiting = false);
