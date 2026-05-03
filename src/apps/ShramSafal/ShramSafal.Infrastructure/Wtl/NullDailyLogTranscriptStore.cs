using ShramSafal.Application.Wtl;

namespace ShramSafal.Infrastructure.Wtl;

/// <summary>
/// Default <see cref="IDailyLogTranscriptStore"/> implementation that
/// always returns <c>null</c>. Wired by DI until transcript persistence
/// lands on the <c>DailyLog</c> aggregate (DWC v2 §2.10 forward-look).
/// </summary>
/// <remarks>
/// <para>
/// The <c>WorkerNameProjector</c> treats null as "no work to do" and
/// no-ops for the event, so this is a safe production default — it makes
/// the projector a registered subscriber without requiring the AI
/// pipeline to first materialize transcripts in the relational store.
/// </para>
/// <para>
/// Tests that exercise the projector substitute a stub store via DI
/// override; see <c>WorkerNameProjectorTests</c>.
/// </para>
/// </remarks>
internal sealed class NullDailyLogTranscriptStore : IDailyLogTranscriptStore
{
    public Task<string?> GetTranscriptAsync(Guid dailyLogId, CancellationToken ct = default)
        => Task.FromResult<string?>(null);
}
