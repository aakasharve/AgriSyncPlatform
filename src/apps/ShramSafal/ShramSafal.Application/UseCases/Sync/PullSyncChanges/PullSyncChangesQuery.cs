namespace ShramSafal.Application.UseCases.Sync.PullSyncChanges;

/// <param name="SinceUtc">The phone's cursor (whole seconds on every phone build).</param>
/// <param name="UserId">The signed-in person.</param>
/// <param name="HeldFarmIds">
/// lane MU-3 fix 1 (F9) — the farms the phone holds (optional, additive: older phones send none). Each one
/// this person may no longer read comes back as an explicit <c>accessScopes</c> entry (Paused / Waiting /
/// Removed), which is the only thing that lets the phone remove a farm's data.
/// </param>
public sealed record PullSyncChangesQuery(DateTime SinceUtc, Guid UserId, IReadOnlyList<Guid>? HeldFarmIds = null);
