// spec: dfes-companion-2026-07-11 (wave-4.4)

using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Work.GetWorkerReputation;

/// <summary>
/// Ask what a worker carries with him — tiers 2 and 3 only.
/// </summary>
/// <remarks>
/// Deliberately has NO farm-scope parameter. A reputation is not a per-farm view; the
/// question "what does this man carry" is answered over every farm the caller is entitled
/// to see, which the guard decides. A farm id here would invite callers to name someone
/// else's farm and read its record of him, which is the tier-1 leak this whole model
/// closes.
/// </remarks>
public sealed record GetWorkerReputationQuery(
    UserId WorkerUserId,
    UserId CallerUserId);
