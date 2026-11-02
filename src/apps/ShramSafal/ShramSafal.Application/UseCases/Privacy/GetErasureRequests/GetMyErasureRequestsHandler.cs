// spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99 fix pass 1, item 11 (founder D-71, 2026-11-02).
using ShramSafal.Application.Ports;
using ShramSafal.Application.Privacy;
using ShramSafal.Domain.Privacy;

namespace ShramSafal.Application.UseCases.Privacy.GetErasureRequests;

/// <summary>One erasure request as its reader sees it: what state it is in, and when erasure starts (D-71).</summary>
/// <param name="ErasureStartsAtUtc">When the worker may take it (requested + the wait).</param>
/// <param name="EndedAtUtc">When it was erased, failed or cancelled; null while it waits or runs.</param>
/// <param name="MayCancel">True only while it waits AND the reader asked for it or it is his data (fix pass 2, N-6).</param>
/// <param name="AskedByMe">False when someone else (the platform admin) asked for it on the reader's behalf.</param>
/// <param name="AboutMe">False when the reader (the platform admin) filed it for SOMEONE ELSE's data (fix pass 2, N-6).</param>
public sealed record ErasureRequestView(
    Guid RequestId,
    string Status,
    DateTime RequestedAtUtc,
    DateTime ErasureStartsAtUtc,
    DateTime? EndedAtUtc,
    bool MayCancel,
    bool AskedByMe,
    bool AboutMe);

/// <summary>
/// The caller's erasure requests, newest first: the ones he asked for, and any asked on his behalf. Read under his own
/// user scope; nobody else's request is ever in it.
/// </summary>
public sealed class GetMyErasureRequestsHandler(IShramSafalRepository repository, ErasureTiming timing)
{
    public async Task<IReadOnlyList<ErasureRequestView>> HandleAsync(Guid callerUserId, CancellationToken ct = default)
    {
        if (callerUserId == Guid.Empty)
        {
            return [];
        }

        var requests = await repository.GetErasureRequestsForUserAsync(callerUserId, ct).ConfigureAwait(false);
        return requests
            .Where(r => r.RequestedByUserId == callerUserId || r.OnBehalfOfUserId == callerUserId)
            .Select(r => new ErasureRequestView(
                r.Id,
                r.Status.ToString(),
                r.RequestedAtUtc,
                timing.ErasureStartsAtUtc(r),
                r.CompletedAtUtc,
                MayCancel: r.IsWaiting && (r.RequestedByUserId == callerUserId || r.TargetUserId == callerUserId),
                AskedByMe: r.RequestedByUserId == callerUserId,
                AboutMe: r.TargetUserId == callerUserId))
            .ToList();
    }
}
