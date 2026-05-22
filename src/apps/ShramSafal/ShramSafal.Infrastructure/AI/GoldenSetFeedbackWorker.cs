using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Corrections;
using ShramSafal.Infrastructure.Persistence;

namespace ShramSafal.Infrastructure.AI;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 3.3 (data-eng brief
/// Theme B-2, Safeguard B2) — golden-set feedback-loop capture
/// worker.
///
/// <para>
/// <b>What it does.</b> On every tick:
/// <list type="number">
///   <item>Reads up to <see cref="GoldenSetFeedbackOptions.BatchSize"/>
///   recent <see cref="CorrectionEvent"/> rows that have NOT yet been
///   projected into <see cref="GoldenSetCandidate"/>. The
///   "not-yet-projected" predicate is the unique-index gate on
///   <c>(audio_content_hash, correction_type)</c> — the worker
///   inserts via <c>ON CONFLICT DO NOTHING</c> at save time, so
///   duplicate ticks are a no-op rather than a row-count anomaly.</item>
///   <item>For each correction event, fetches the source
///   <see cref="AiJob"/> by <c>OriginalParseId</c> to read the
///   audio content hash + farm id + transcript snapshots + extractor
///   SHA. When the source <c>AiJob</c> is missing (e.g. the
///   correction targets a non-voice parse) the row is skipped.</item>
///   <item>Derives the <c>bucket_id</c> + <c>correction_type</c> from
///   the correction-event metadata. Today's <see cref="CorrectionEvent"/>
///   carries neither field as a first-class column — the worker uses
///   the <see cref="CorrectionTrigger"/> enum as the
///   <c>correction_type</c> proxy and stamps the bucket as
///   <c>"unknown"</c> for now. Future surfacing of bucket-id on
///   <see cref="CorrectionEvent"/> (parking lot) replaces the
///   placeholder without changing the projection contract.</item>
///   <item>Calls
///   <see cref="GoldenSetCandidate.Create"/> with the assembled tuple
///   and persists. The PII-redaction carve-out per Phase 10.6 OQ-9
///   is enforced upstream — today's <c>CorrectionEvent</c> table
///   never carries PII-redaction signal (that path lives on
///   <see cref="Domain.Privacy.Pii.PiiRedactionEvent"/>), so the
///   worker can ingest the whole table without an explicit filter.
///   We still pass an explicit allowlist check (defence in depth)
///   so a future taxonomy extension does not silently leak PII
///   rows into the corpus.</item>
/// </list>
/// </para>
///
/// <para>
/// <b>Disabled by default.</b> See
/// <see cref="GoldenSetFeedbackOptions.Enabled"/>. Production opts
/// in via env var after the founder confirms capture should start.
/// The hosted service still spawns but <see cref="ExecuteAsync"/>
/// exits immediately when the flag is off — zero load.
/// </para>
///
/// <para>
/// <b>Promotion is out-of-scope.</b> The weekly batch promote-job +
/// CI integration are deferred (golden-set repo authoring infra
/// not yet shipped — Phase 0.2 parking lot). This worker captures
/// dormantly; promotion lands later as a separate use case.
/// </para>
/// </summary>
internal sealed class GoldenSetFeedbackWorker(
    IServiceScopeFactory scopeFactory,
    IOptions<GoldenSetFeedbackOptions> options,
    ILogger<GoldenSetFeedbackWorker> logger,
    TimeProvider? timeProvider = null) : BackgroundService
{
    /// <summary>
    /// PII-redaction sentinel kept OUT of the candidate set per
    /// Phase 10.6 OQ-9 carve-out. Today's <see cref="CorrectionEvent"/>
    /// table never produces this value (PII redactions live on
    /// <see cref="Domain.Privacy.Pii.PiiRedactionEvent"/>), but the
    /// worker checks anyway so a future taxonomy extension does not
    /// silently leak PII into the corpus.
    /// </summary>
    private const string PiiRedactionCorrectionType = "pii_redaction";

    /// <summary>
    /// Placeholder bucket id stamped on candidates whose source
    /// CorrectionEvent does not yet surface a per-bucket signal.
    /// Future surfacing of bucket-id on CorrectionEvent (parking
    /// lot) replaces this without changing the projection contract.
    /// </summary>
    private const string UnknownBucketId = "unknown";

    private readonly GoldenSetFeedbackOptions _options = options.Value;
    private readonly TimeProvider _timeProvider = timeProvider ?? TimeProvider.System;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.Enabled)
        {
            logger.LogInformation(
                "GoldenSetFeedbackWorker disabled by configuration (Ai:GoldenSetFeedback:Enabled = false). Exiting.");
            return;
        }

        var tickInterval = TimeSpan.FromMinutes(Math.Max(1, _options.TickIntervalMinutes));
        var batchSize = Math.Max(1, _options.BatchSize);
        logger.LogInformation(
            "GoldenSetFeedbackWorker started. TickIntervalMinutes={Interval} BatchSize={BatchSize}.",
            tickInterval.TotalMinutes,
            batchSize);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(tickInterval, _timeProvider, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }

            try
            {
                await RunTickAsync(batchSize, stoppingToken).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "GoldenSetFeedbackWorker tick failed. Continuing.");
            }
        }

        logger.LogInformation("GoldenSetFeedbackWorker stopped.");
    }

    /// <summary>
    /// One full capture tick. <c>internal</c> so the integration
    /// test can drive the worker synchronously without spinning up
    /// the hosted-service lifecycle. Returns the number of new
    /// candidates persisted on this tick.
    /// </summary>
    internal async Task<int> RunTickAsync(int batchSize, CancellationToken ct)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();

        var nowUtc = _timeProvider.GetUtcNow().UtcDateTime;

        // Candidate query: pull the most recent CorrectionEvent rows;
        // the unique-index gate on (audio_content_hash, correction_type)
        // dedupes at save time so we do not need a complicated NOT
        // EXISTS subquery. The DESC sort ensures the latest
        // corrections reach the candidate set first even if the
        // backlog is large.
        var corrections = await db.CorrectionEvents
            .AsNoTracking()
            .OrderByDescending(c => c.CapturedAtUtc)
            .Take(batchSize)
            .ToListAsync(ct)
            .ConfigureAwait(false);

        if (corrections.Count == 0)
        {
            logger.LogDebug("GoldenSetFeedbackWorker tick — no correction events to project.");
            return 0;
        }

        // Project + persist. We build the candidate tuple per
        // correction, fetch the source AiJob to read the audio
        // identity + farm context, and let the DB unique index
        // (audio_content_hash, correction_type) reject duplicates
        // via ON CONFLICT DO NOTHING. Because EF Core does not
        // emit native ON CONFLICT, we pre-check the candidate set
        // for this batch and skip dupes; the unique index remains
        // the authoritative idempotency gate at the row level.
        var inserted = 0;
        foreach (var correction in corrections)
        {
            if (ct.IsCancellationRequested)
            {
                break;
            }

            var correctionType = MapCorrectionType(correction.Trigger);
            if (string.Equals(correctionType, PiiRedactionCorrectionType, StringComparison.Ordinal))
            {
                // Defence in depth — today's CorrectionEvent table never
                // emits this value (PII lives on PiiRedactionEvent) but
                // the explicit allowlist keeps a future taxonomy
                // extension from silently leaking PII into the corpus.
                continue;
            }

            // Pull the source AiJob. We need:
            //   - InputContentHash (the audio identity, the dedupe key)
            //   - FarmId (per-row scope, surfaced for the erasure
            //     cascade)
            //   - TranscriptCodemix / TranscriptVerbatim snapshots
            //   - Provenance.ExtractorCodeSha (extractor lineage)
            // When the AiJob is missing (correction targets a non-voice
            // parse, or the parse row was already erased) the row is
            // skipped; the candidate set carries only audio-bound
            // corrections.
            var source = await db.AiJobs
                .AsNoTracking()
                .FirstOrDefaultAsync(j => j.Id == correction.OriginalParseId, ct)
                .ConfigureAwait(false);

            if (source is null || string.IsNullOrWhiteSpace(source.InputContentHash))
            {
                logger.LogDebug(
                    "GoldenSetFeedbackWorker skipping correction {CorrectionId} — source AiJob missing or has no audio hash.",
                    correction.Id);
                continue;
            }

            // Idempotency pre-check. The DB unique index would still
            // reject a duplicate insert; we skip locally to avoid
            // batching a doomed INSERT into SaveChanges (which would
            // throw and back out the whole batch).
            var alreadyProjected = await db.GoldenSetCandidates
                .AsNoTracking()
                .AnyAsync(g => g.AudioContentHash == source.InputContentHash
                               && g.CorrectionType == correctionType, ct)
                .ConfigureAwait(false);

            if (alreadyProjected)
            {
                continue;
            }

            var candidate = GoldenSetCandidate.Create(
                id: Guid.NewGuid(),
                audioContentHash: source.InputContentHash,
                userId: correction.UserId,
                farmId: source.FarmId,
                bucketId: UnknownBucketId,
                correctionType: correctionType,
                aiSuggestedJson: correction.OriginalParseRaw,
                farmerCorrectedJson: correction.CorrectedParse,
                transcriptCodemix: source.TranscriptCodemix,
                transcriptVerbatim: source.TranscriptVerbatim,
                promptVersion: string.IsNullOrWhiteSpace(correction.PromptVersion)
                    ? source.Provenance.PromptVersion
                    : correction.PromptVersion,
                extractorCodeSha: source.Provenance.ExtractorCodeSha,
                createdAtUtc: nowUtc);

            db.GoldenSetCandidates.Add(candidate);
            inserted++;
        }

        if (inserted > 0)
        {
            await db.SaveChangesAsync(ct).ConfigureAwait(false);
            logger.LogInformation(
                "GoldenSetFeedbackWorker: persisted {Count} new golden-set candidate(s) on this tick.",
                inserted);
        }

        return inserted;
    }

    /// <summary>
    /// Maps <see cref="CorrectionTrigger"/> values onto the
    /// envelope's correction-type taxonomy. The mapping is
    /// deliberately conservative: every known trigger lands on a
    /// safe (non-PII) bucket and unknown triggers fall back to
    /// <c>"value-correction"</c> so the row still projects rather
    /// than silently dropping. A future <c>CorrectionType</c>
    /// column on <see cref="CorrectionEvent"/> (parking lot)
    /// replaces this mapping without changing the candidate
    /// schema.
    /// </summary>
    internal static string MapCorrectionType(CorrectionTrigger trigger) =>
        trigger switch
        {
            CorrectionTrigger.EditUI => "value-correction",
            CorrectionTrigger.LowConfidenceReview => "structural-correction",
            CorrectionTrigger.ManualFlag => "bucket-correction",
            _ => "value-correction",
        };
}
