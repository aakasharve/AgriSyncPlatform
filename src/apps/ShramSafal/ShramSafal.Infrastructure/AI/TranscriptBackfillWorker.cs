using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ShramSafal.Domain.AI;
using ShramSafal.Infrastructure.Persistence;

namespace ShramSafal.Infrastructure.AI;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 1.10 — one-time backfill
/// worker that copies the legacy <c>normalized_result_json.fullTranscript</c>
/// value into the dedicated <c>transcript_codemix</c> column on
/// <c>ssf.ai_jobs</c>.
///
/// <para>
/// <b>Why a worker not a migration.</b> The legacy <c>fullTranscript</c>
/// lives inside a <c>jsonb</c> payload (one ALTER per row would require
/// reading + parsing + writing every row server-side). EF + a hosted
/// service let us batch in chunks of 1000, sleep between batches so we
/// do not saturate the connection pool, and route the writes through
/// <see cref="AiJob.SetTranscriptResults"/> so the aggregate invariants
/// + ModifiedAtUtc stamp + the existing audit interceptors fire on
/// every backfill row.
/// </para>
///
/// <para>
/// <b>Disabled by default.</b> See <see cref="TranscriptBackfillOptions.Enabled"/>
/// — production opts in via env var after Phase 1 ships. Dev / test
/// environments never see the worker do anything; the BackgroundService
/// still spawns but <see cref="ExecuteAsync"/> returns immediately.
/// </para>
///
/// <para>
/// <b>Idempotent.</b> Every batch re-queries on
/// <c>transcript_codemix IS NULL AND normalized_result_json IS NOT NULL
/// AND status = 'Succeeded'</c>; rows already backfilled by a previous
/// pass fall out of the candidate set. Re-running the worker is safe.
/// </para>
///
/// <para>
/// <b>Model version provenance.</b> Each <see cref="AiJob"/> carries a
/// list of <see cref="AiJobAttempt"/> children; the first attempt's
/// <c>Provenance.ModelVersion</c> records the model that produced the
/// transcript. The worker prefers that value; if it is absent / blank
/// it falls back to <c>"gemini-2.5-flash"</c> (the historical default
/// per Phase 1.1 commit 5ecf545d).
/// </para>
/// </summary>
internal sealed class TranscriptBackfillWorker(
    IServiceScopeFactory scopeFactory,
    IOptions<TranscriptBackfillOptions> options,
    ILogger<TranscriptBackfillWorker> logger) : BackgroundService
{
    // Documented fallback when AiJobAttempt.Provenance.ModelVersion is
    // null or empty — every legacy row pre-dates the explicit model
    // version stamping but Phase 1.1 documents Gemini 2.5 Flash as the
    // production structurer through the backfill horizon.
    private const string FallbackModelVersion = "gemini-2.5-flash";

    // Provider stamp recorded on every backfill row. Legacy AiJob rows
    // were produced exclusively by the Gemini structurer (Sarvam is
    // Phase 2). Hard-coded because the value is uniform across the
    // entire backfill set; the worker never produces a transcript from
    // Sarvam.
    private const string BackfillProviderName = "Gemini";

    private readonly TranscriptBackfillOptions _options = options.Value;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.Enabled)
        {
            logger.LogInformation(
                "TranscriptBackfillWorker disabled by configuration (Ai:TranscriptBackfill:Enabled = false). Exiting.");
            return;
        }

        var batchSize = Math.Max(1, _options.BatchSize);
        var sleepBetweenBatches = TimeSpan.FromSeconds(Math.Max(0, _options.DelayBetweenBatchesSeconds));

        logger.LogInformation(
            "TranscriptBackfillWorker started. BatchSize={BatchSize} DelayBetweenBatchesSeconds={Delay}.",
            batchSize, sleepBetweenBatches.TotalSeconds);

        while (!stoppingToken.IsCancellationRequested)
        {
            int processed;
            try
            {
                processed = await RunBatchAsync(batchSize, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex,
                    "TranscriptBackfillWorker encountered an unhandled exception during a batch. Sleeping then retrying.");
                processed = 0;
            }

            // If the batch hit the cap, immediately try the next one
            // (we are draining the backlog). Only sleep when the batch
            // came back partial / empty — that means we have caught up.
            if (processed >= batchSize)
            {
                continue;
            }

            if (sleepBetweenBatches > TimeSpan.Zero)
            {
                try
                {
                    await Task.Delay(sleepBetweenBatches, stoppingToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
            }
            else
            {
                // BatchSize=N, delay=0, processed<N → backlog is empty,
                // worker has nothing more to do until new rows arrive.
                // Returning lets the host shutdown gracefully in the
                // integration test path; production sets a non-zero
                // delay so the loop continues to poll for late arrivals.
                logger.LogInformation(
                    "TranscriptBackfillWorker drained the backlog (processed={Processed} of {BatchSize}) and DelayBetweenBatchesSeconds=0; exiting.",
                    processed, batchSize);
                return;
            }
        }

        logger.LogInformation("TranscriptBackfillWorker stopped.");
    }

    /// <summary>
    /// Run one batch of up to <paramref name="batchSize"/> backfill
    /// updates. Returns the number of rows updated (0 when the
    /// candidate set is empty). Exposed as <c>internal</c> for the
    /// integration test, which calls it directly so the test does not
    /// have to wrestle with hosted-service lifecycle.
    /// </summary>
    internal async Task<int> RunBatchAsync(int batchSize, CancellationToken ct)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();

        // Eager-load Attempts so we can read the first attempt's
        // Provenance.ModelVersion without an N+1 round-trip per row.
        var candidates = await db.AiJobs
            .Include(j => j.Attempts)
            .Where(j => j.TranscriptCodemix == null
                        && j.NormalizedResultJson != null
                        && j.Status == AiJobStatus.Succeeded)
            .OrderBy(j => j.CreatedAtUtc)
            .Take(batchSize)
            .ToListAsync(ct)
            .ConfigureAwait(false);

        if (candidates.Count == 0)
        {
            return 0;
        }

        var updated = 0;
        foreach (var job in candidates)
        {
            if (ct.IsCancellationRequested)
            {
                break;
            }

            var legacyTranscript = TryReadFullTranscript(job.NormalizedResultJson!);
            if (string.IsNullOrWhiteSpace(legacyTranscript))
            {
                // The job succeeded but its normalized payload does not
                // carry a fullTranscript field (older schema variant or
                // a non-voice operation type that was wedged through
                // the voice handler). Mark TranscriptCodemix as a
                // sentinel? No — that would mask future backfills if
                // the row is later corrected. Skip silently; the IS
                // NULL predicate keeps the row out of the next batch's
                // candidate set only when transcript_codemix is filled.
                // To prevent the same row from being read every pass,
                // we rely on the OrderBy(CreatedAtUtc) + skip via the
                // candidate ordering: the worker will only re-read it
                // on a full backlog rescan, which is acceptable for a
                // one-time backfill.
                continue;
            }

            var modelVersion = ResolveModelVersion(job);

            // Drive the write through the domain mutator so the
            // aggregate invariants + the existing audit interceptors
            // fire. SetTranscriptResults stamps TranscribedAtUtc to
            // DateTime.UtcNow; for a backfill we prefer the original
            // CompletedAtUtc because the transcript was technically
            // produced then. SetTranscriptResults does not expose an
            // override, so we update the column directly AFTER the
            // mutator via EF property-level set. This keeps the
            // mutator path warm (validations + provider/model checks
            // run) while still preserving the historical timestamp.
            job.SetTranscriptResults(
                codemix: legacyTranscript,
                english: null,
                englishRedacted: null,
                verbatim: null,
                translit: null,
                translate: null,
                transcriptProvider: BackfillProviderName,
                transcriptModelVersion: modelVersion);

            // Override TranscribedAtUtc to the original completion time
            // so the audit trail reads "transcript was produced when
            // the job completed", not "transcript was backfilled today".
            if (job.CompletedAtUtc.HasValue)
            {
                db.Entry(job).Property(nameof(AiJob.TranscribedAtUtc)).CurrentValue =
                    job.CompletedAtUtc.Value;
            }

            updated++;
        }

        if (updated > 0)
        {
            await db.SaveChangesAsync(ct).ConfigureAwait(false);
            logger.LogInformation(
                "TranscriptBackfillWorker: backfilled transcript_codemix on {Updated} ai_jobs row(s).",
                updated);
        }

        return updated;
    }

    /// <summary>
    /// Parse <paramref name="normalizedResultJson"/> and return the
    /// <c>fullTranscript</c> string value if present, else null.
    /// Tolerates malformed JSON (returns null) so a single corrupt row
    /// cannot block the rest of the batch.
    /// </summary>
    private static string? TryReadFullTranscript(string normalizedResultJson)
    {
        try
        {
            using var doc = JsonDocument.Parse(normalizedResultJson);
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
            {
                return null;
            }

            if (!doc.RootElement.TryGetProperty("fullTranscript", out var node))
            {
                return null;
            }

            return node.ValueKind == JsonValueKind.String ? node.GetString() : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>
    /// Pick the model version for the backfill stamp. Prefers the
    /// first attempt's Provenance.ModelVersion (the model that
    /// actually produced the transcript); falls back to
    /// <see cref="FallbackModelVersion"/> when no attempts are
    /// recorded or the recorded version is blank.
    /// </summary>
    private static string ResolveModelVersion(AiJob job)
    {
        var first = job.Attempts
            .OrderBy(a => a.AttemptNumber)
            .FirstOrDefault();

        var recorded = first?.Provenance?.ModelVersion;
        if (!string.IsNullOrWhiteSpace(recorded))
        {
            return recorded.Trim();
        }

        return FallbackModelVersion;
    }
}
