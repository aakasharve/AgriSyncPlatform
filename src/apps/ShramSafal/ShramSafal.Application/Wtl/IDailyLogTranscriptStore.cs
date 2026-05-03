namespace ShramSafal.Application.Wtl;

/// <summary>
/// Read-only port for fetching the original Marathi transcript that
/// produced a given <c>DailyLog</c>. Used by the
/// <see cref="IWorkerNameProjector"/> to feed the
/// <see cref="IWorkerNameExtractor"/>.
/// </summary>
/// <remarks>
/// <para>
/// DWC v2 §2.10. Transcripts are not yet persisted in the
/// <c>DailyLog</c> aggregate (they live only in the mobile-web Dexie
/// outbox today), so the default infrastructure implementation returns
/// <c>null</c> for every query. The projector contract is finalised
/// against this port so future transcript-persistence work plugs in
/// behind a single seam without touching the projector itself.
/// </para>
/// <para>
/// Returns <c>null</c> when no transcript exists for the supplied id —
/// callers must treat null as "no work to do" rather than an error.
/// </para>
/// </remarks>
public interface IDailyLogTranscriptStore
{
    Task<string?> GetTranscriptAsync(Guid dailyLogId, CancellationToken ct = default);
}
