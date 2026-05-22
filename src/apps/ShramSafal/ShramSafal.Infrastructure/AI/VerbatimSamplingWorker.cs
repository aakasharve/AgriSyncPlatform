using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Application.Storage;
using ShramSafal.Domain.AI;
using ShramSafal.Infrastructure.Integrations.Sarvam;
using ShramSafal.Infrastructure.Persistence;

namespace ShramSafal.Infrastructure.AI;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.11 — verbatim D-MOAT
/// sampling worker. Periodic background scan over recently-completed
/// Sarvam <c>VoiceToStructuredLog</c> ai_jobs that picks a deterministic
/// 10% slice (hash-bucket sampling) AND requires per-user opt-in to
/// <see cref="ConsentPurpose.VerbatimTrainingCorpus"/>; emits one
/// <c>SarvamVerbatimSttClient.TranscribeVerbatimAsync</c> call per
/// survivor and persists the result back onto
/// <see cref="AiJob.TranscriptVerbatim"/> via
/// <see cref="AiJob.SetTranscriptResults"/> (preserving every existing
/// transcript field).
///
/// <para>
/// <b>Three independent gates.</b>
/// <list type="number">
///   <item><see cref="VerbatimSamplingOptions.Enabled"/> — env-var
///   master kill-switch (default <c>false</c>).</item>
///   <item><c>ssf.feature_flags WHERE flag_name='verbatim_corpus_sampling_enabled'</c>
///   — cohort gate flipped from the admin surface. Worker tick aborts
///   silently when the row is missing or disabled (Safeguard S7).</item>
///   <item><c>ssf.mode_policy WHERE trigger_type='verbatim_sample'</c>
///   — cost cap. Worker accumulates today's verbatim spend via
///   <see cref="AiProviderSpendDaily"/> rows tagged
///   <see cref="AiProviderType.Sarvam"/> +
///   <see cref="AiOperationType.VoiceToStructuredLog"/>, and halts the
///   current tick when the rollup is at or past the configured cap.</item>
/// </list>
/// All three must agree before the worker calls Sarvam.
/// </para>
///
/// <para>
/// <b>Per-row gates.</b> For every candidate row the worker additionally
/// requires:
/// <list type="bullet">
///   <item>A non-blank <see cref="AiJob.InputContentHash"/>. We hash the
///   first 8 hex chars as <c>Int32</c> and keep rows where
///   <c>(hash mod 100) &lt; SamplingRatePercent</c>. Default 10% per
///   ADR-DS-014 §C.</item>
///   <item><see cref="IConsentEnforcer"/> returns
///   <see cref="ConsentDecision.Allowed"/> for the row's
///   <see cref="AiJob.UserId"/> against
///   <see cref="ConsentPurpose.VerbatimTrainingCorpus"/>. Default-false
///   on the aggregate ensures unenrolled users fail closed.</item>
///   <item>The cold-tier raw audio blob is still resolvable via
///   <see cref="IRawBlobStore"/> keyed on the same content hash.
///   Missing blobs are logged at <c>Debug</c> and skipped — they will
///   re-enter the candidate set on the next tick if eventually
///   restored.</item>
/// </list>
/// </para>
///
/// <para>
/// <b>Idempotent + replay-safe.</b> The worker re-queries
/// <c>WHERE transcript_verbatim IS NULL AND transcript_provider='Sarvam'
/// AND completed_at_utc &gt;= now()-24h</c>; rows already filled by a
/// previous pass fall out of the candidate set. The Sarvam REST adapter
/// is itself idempotent on
/// <c>(audio_content_hash, model, 'verbatim')</c> via
/// <c>ssf.transcript_history</c>, so even a partial cycle (e.g. process
/// crashed after the Sarvam call but before the AiJob save) returns the
/// cached transcript on retry without re-billing.
/// </para>
///
/// <para>
/// <b>Cost accounting.</b> Per envelope task 2.11a/2.11, each Sarvam
/// verbatim call appends an <see cref="AiJobAttempt"/> onto the parent
/// <see cref="AiJob"/> with the estimated cost stamped via
/// <see cref="AiJobAttempt.SetEstimatedCostUnits"/>. The existing
/// <see cref="AiCostBudgetGuard"/> aggregates today's attempts into
/// <see cref="AiProviderSpendDaily"/> on its next tick, so the verbatim
/// spend flows through the same rollup as the orchestrator's primary
/// path. No separate ledger.
/// </para>
/// </summary>
internal sealed class VerbatimSamplingWorker(
    IServiceScopeFactory scopeFactory,
    IOptions<VerbatimSamplingOptions> options,
    ILogger<VerbatimSamplingWorker> logger,
    TimeProvider? timeProvider = null) : BackgroundService
{
    // ssf.feature_flags row that gates the worker per Safeguard S7.
    private const string CohortFlagName = "verbatim_corpus_sampling_enabled";

    // ssf.mode_policy row whose MaxDailyCostInr caps today's verbatim spend.
    private const string CostCapTriggerType = "verbatim_sample";

    // Sarvam attempts on the verbatim path are credited against the
    // existing VoiceToStructuredLog rollup bucket so the AiCostBudgetGuard
    // aggregator picks them up alongside the primary orchestrator's calls.
    private const AiOperationType BillingOperation = AiOperationType.VoiceToStructuredLog;

    private readonly VerbatimSamplingOptions _options = options.Value;
    private readonly TimeProvider _timeProvider = timeProvider ?? TimeProvider.System;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.Enabled)
        {
            logger.LogInformation(
                "VerbatimSamplingWorker disabled by configuration (Ai:VerbatimSampling:Enabled = false). Exiting.");
            return;
        }

        var tickInterval = TimeSpan.FromMinutes(Math.Max(1, _options.TickIntervalMinutes));
        var batchSize = Math.Max(1, _options.BatchSize);
        logger.LogInformation(
            "VerbatimSamplingWorker started. TickIntervalMinutes={Interval} BatchSize={BatchSize} SamplingRatePercent={Rate}.",
            tickInterval.TotalMinutes,
            batchSize,
            ClampSamplingRate(_options.SamplingRatePercent));

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
                logger.LogWarning(ex, "VerbatimSamplingWorker tick failed. Continuing.");
            }
        }

        logger.LogInformation("VerbatimSamplingWorker stopped.");
    }

    /// <summary>
    /// One full sampling tick. <c>internal</c> so the integration test can
    /// drive the worker synchronously without spinning up the hosted
    /// service lifecycle. Returns the number of rows for which a verbatim
    /// transcript was newly persisted on this tick.
    /// </summary>
    internal async Task<int> RunTickAsync(int batchSize, CancellationToken ct)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();

        // Gate 1 — cohort feature flag. Safeguard S7 makes this the
        // operator's manual lever to halt sampling without bouncing the
        // process; a missing row reads as "off".
        var cohortFlag = await db.FeatureFlags
            .AsNoTracking()
            .FirstOrDefaultAsync(f => f.FlagName == CohortFlagName, ct)
            .ConfigureAwait(false);

        if (cohortFlag is null || !cohortFlag.Enabled)
        {
            logger.LogDebug(
                "VerbatimSamplingWorker tick aborted — feature flag '{FlagName}' missing or disabled.",
                CohortFlagName);
            return 0;
        }

        // Gate 2 — cost cap from mode_policy. The aggregator (Phase 2.7)
        // refreshes ai_provider_spend_daily on its own cadence; we read
        // the rollup row for today and stop the tick if today's verbatim
        // spend is at or beyond the cap. The cap is hard-edged
        // (≥ stops the tick); we do NOT enter "one more under" mode
        // because verbatim audio is bursty and a single 60s clip can
        // overshoot.
        var policy = await db.ModePolicies
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.TriggerType == CostCapTriggerType && p.Enabled, ct)
            .ConfigureAwait(false);

        var dailyCap = policy?.MaxDailyCostInr;
        var nowUtc = _timeProvider.GetUtcNow().UtcDateTime;
        var today = DateOnly.FromDateTime(nowUtc);
        var twentyFourHoursAgo = nowUtc.AddHours(-24);

        if (dailyCap.HasValue && dailyCap.Value > 0m)
        {
            var todaySpend = await db.AiProviderSpendDaily
                .AsNoTracking()
                .Where(x => x.DayUtc == today
                            && x.Provider == AiProviderType.Sarvam
                            && x.Operation == BillingOperation)
                .SumAsync(x => (decimal?)x.TotalInr, ct)
                .ConfigureAwait(false) ?? 0m;

            if (todaySpend >= dailyCap.Value)
            {
                logger.LogInformation(
                    "VerbatimSamplingWorker tick aborted — today's Sarvam VoiceToStructuredLog spend {SpendInr:F2} INR has reached the verbatim cap {CapInr:F2} INR. Will retry on next tick.",
                    todaySpend,
                    dailyCap.Value);
                return 0;
            }
        }

        // Candidate query — last 24h, status=Succeeded, Sarvam-stamped,
        // verbatim not yet filled. We project to the minimum fields the
        // sampler needs so the load is bounded by BatchSize regardless
        // of attempt/Provenance child rows on ai_jobs. Sort by
        // CompletedAtUtc DESC so the most recent rows are sampled first
        // (fresh clips matter more than backlog for D-MOAT freshness).
        var candidates = await db.AiJobs
            .AsNoTracking()
            .Where(j => j.TranscriptVerbatim == null
                        && j.TranscriptProvider == "Sarvam"
                        && j.Status == AiJobStatus.Succeeded
                        && j.CompletedAtUtc != null
                        && j.CompletedAtUtc >= twentyFourHoursAgo
                        && j.InputContentHash != null)
            .OrderByDescending(j => j.CompletedAtUtc)
            .Take(batchSize)
            .Select(j => new VerbatimCandidate(
                j.Id,
                j.UserId,
                j.InputContentHash!,
                j.RawInputRef,
                j.InputSessionMetadataJson,
                j.TranscriptEnglish,
                j.TranscriptEnglishRedacted,
                j.TranscriptTranslit,
                j.TranscriptTranslate,
                j.TranscriptCodemix,
                j.TranscriptModelVersion))
            .ToListAsync(ct)
            .ConfigureAwait(false);

        if (candidates.Count == 0)
        {
            logger.LogDebug("VerbatimSamplingWorker tick — no candidate rows in last 24h.");
            return 0;
        }

        var rate = ClampSamplingRate(_options.SamplingRatePercent);
        var consentEnforcer = scope.ServiceProvider.GetRequiredService<IConsentEnforcer>();
        var verbatimClient = scope.ServiceProvider.GetRequiredService<SarvamVerbatimSttClient>();
        var rawBlobStore = scope.ServiceProvider.GetRequiredService<IRawBlobStore>();
        var costEstimator = scope.ServiceProvider.GetRequiredService<AiAttemptCostEstimator>();

        var updated = 0;
        foreach (var candidate in candidates)
        {
            if (ct.IsCancellationRequested)
            {
                break;
            }

            if (!FallsInSamplingBucket(candidate.InputContentHash, rate))
            {
                continue;
            }

            var decision = await consentEnforcer
                .RequireGrantAsync(candidate.UserId, ConsentPurpose.VerbatimTrainingCorpus, ct)
                .ConfigureAwait(false);

            if (!decision.IsAllowed)
            {
                // ConsentEnforcer already wrote the deny-audit row; we
                // just log at Debug and skip.
                logger.LogDebug(
                    "VerbatimSamplingWorker skipping job {JobId} — consent denied ({Reason}).",
                    candidate.JobId,
                    decision.DenyReason);
                continue;
            }

            // Pull the cold-tier blob. The cold-tier key is the SHA-256
            // hash of the audio bytes (per IRawBlobStore contract) — the
            // same value persisted as AiJob.InputContentHash.
            Stream? audioStream;
            try
            {
                audioStream = await rawBlobStore.GetAsync(candidate.InputContentHash, ct).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                logger.LogDebug(ex,
                    "VerbatimSamplingWorker skipping job {JobId} — raw audio blob not retrievable (hash={Hash}).",
                    candidate.JobId,
                    candidate.InputContentHash);
                continue;
            }

            if (audioStream is null)
            {
                logger.LogDebug(
                    "VerbatimSamplingWorker skipping job {JobId} — raw blob store returned null stream.",
                    candidate.JobId);
                continue;
            }

            await using var ownedStream = audioStream;

            // MIME type and language hint — we do NOT carry the original
            // values on AiJob today (the input is normalized to PCM by
            // the streaming adapter before storage). Per the
            // SarvamVerbatimSttClient contract a blank MIME falls back
            // to audio/wav and a blank language hint falls back to the
            // SarvamOptions default (mr-IN). Both safe defaults for
            // verbatim STT.
            var verbatimResult = await verbatimClient
                .TranscribeVerbatimAsync(
                    ownedStream,
                    mimeType: string.Empty,
                    languageHint: string.Empty,
                    audioContentHash: candidate.InputContentHash,
                    ct: ct)
                .ConfigureAwait(false);

            if (!verbatimResult.IsSuccess || string.IsNullOrWhiteSpace(verbatimResult.Transcript))
            {
                logger.LogWarning(
                    "VerbatimSamplingWorker: Sarvam verbatim call failed for job {JobId} (hash={Hash}) — {Error}",
                    candidate.JobId,
                    candidate.InputContentHash,
                    verbatimResult.Error);
                continue;
            }

            // Persist back onto the AiJob aggregate. SetTranscriptResults
            // is the single mutator authored in Phase 1.1 that stamps
            // every transcript variant + provider + model + ModifiedAtUtc
            // atomically. We pass through every existing transcript
            // value so the call does NOT clear codemix/english/etc that
            // were filled by the primary orchestrator path.
            var jobForUpdate = await db.AiJobs
                .Include(j => j.Attempts)
                .FirstOrDefaultAsync(j => j.Id == candidate.JobId, ct)
                .ConfigureAwait(false);

            if (jobForUpdate is null)
            {
                // Race between candidate fetch and update — row deleted
                // (extremely unlikely but possible across erasure). Skip.
                continue;
            }

            // Stamp a new attempt so the AiCostBudgetGuard aggregator
            // picks up the verbatim call's INR estimate on its next
            // rollup tick. We use the candidate's known hash as the
            // request payload hash (the audio content hash IS the
            // dedupe key — same hash means Sarvam already returned the
            // cached transcript per its idempotency contract).
            var verbatimAttempt = jobForUpdate.AddAttempt(
                provider: AiProviderType.Sarvam,
                requestPayloadHash: candidate.InputContentHash);
            verbatimAttempt.RecordSuccess(
                rawResponse: string.Empty,
                latencyMs: 0,
                tokens: null,
                confidence: null);

            // We do not know the payload byte length here without
            // re-reading the stream (which was already consumed). The
            // estimator's payload-bytes input is a tie-break for
            // variable-cost estimation; for verbatim STT the dominant
            // cost driver is duration_seconds, which we pass via
            // InputSpeechDurationMs (persisted on AiJob). When that is
            // null the estimator falls back to a payload-bytes-derived
            // heuristic; passing 0 bytes is safe because the duration
            // path dominates.
            var estimatedCost = costEstimator.EstimateUnits(
                provider: AiProviderType.Sarvam,
                operation: BillingOperation,
                payloadBytes: 0,
                inputSpeechDurationMs: jobForUpdate.InputSpeechDurationMs,
                inputRawDurationMs: jobForUpdate.InputRawDurationMs);
            verbatimAttempt.SetEstimatedCostUnits(estimatedCost);

            jobForUpdate.SetTranscriptResults(
                codemix: candidate.TranscriptCodemix,
                english: candidate.TranscriptEnglish,
                englishRedacted: candidate.TranscriptEnglishRedacted,
                verbatim: verbatimResult.Transcript,
                translit: candidate.TranscriptTranslit,
                translate: candidate.TranscriptTranslate,
                transcriptProvider: "Sarvam",
                transcriptModelVersion: ResolveModelVersion(candidate.TranscriptModelVersion));

            updated++;
        }

        if (updated > 0)
        {
            await db.SaveChangesAsync(ct).ConfigureAwait(false);
            logger.LogInformation(
                "VerbatimSamplingWorker: persisted {Count} verbatim transcript(s) on this tick.",
                updated);
        }

        return updated;
    }

    /// <summary>
    /// Deterministic hash-bucket filter. Parses the first 8 hex chars of
    /// <paramref name="audioContentHash"/> as <c>Int32</c>, takes the
    /// absolute value (to discard the sign bit so the mod is uniform),
    /// and returns <c>true</c> when <c>(value mod 100) &lt; rate</c>.
    /// Returns <c>false</c> when the hash is malformed (too short / not
    /// hex) — those rows are skipped silently rather than blocked
    /// because the upstream pipeline may produce non-SHA-shaped hashes
    /// during migration windows.
    /// </summary>
    internal static bool FallsInSamplingBucket(string audioContentHash, int rate)
    {
        if (rate <= 0)
        {
            return false;
        }

        if (rate >= 100)
        {
            return true;
        }

        if (string.IsNullOrWhiteSpace(audioContentHash) || audioContentHash.Length < 8)
        {
            return false;
        }

        // UInt32.TryParse on the 8-hex-char prefix avoids the INT_MIN
        // overflow trap: Int32.Parse on "80000000" yields INT_MIN, and
        // Math.Abs(INT_MIN) throws OverflowException. UInt32 covers the
        // entire unsigned 2^32 space, modulo 100 gives uniform bucket
        // distribution (2^32 / 100 = ~42M; remainder bias is negligible).
        if (!uint.TryParse(
                audioContentHash.AsSpan(0, 8),
                NumberStyles.HexNumber,
                CultureInfo.InvariantCulture,
                out var leading))
        {
            return false;
        }

        return leading % 100 < rate;
    }

    private static int ClampSamplingRate(int candidate)
    {
        if (candidate < 0) return 0;
        if (candidate > 100) return 100;
        return candidate;
    }

    /// <summary>
    /// Pick the model version stamp for the verbatim write. Prefers the
    /// candidate row's existing <c>transcript_model_version</c> (so the
    /// verbatim variant shares the lineage stamp with the codemix
    /// variant — both came from the same Sarvam Saaras V3 family);
    /// falls back to <c>"saaras:v3"</c> when the candidate has no
    /// recorded model (legacy rows pre-Phase 2 may lack it).
    /// </summary>
    private static string ResolveModelVersion(string? candidateModel) =>
        string.IsNullOrWhiteSpace(candidateModel) ? "saaras:v3" : candidateModel.Trim();

    /// <summary>
    /// Lightweight projection used by the candidate query. Holding only
    /// the minimum surface keeps the per-row memory cost bounded so we
    /// can raise BatchSize without worrying about attempt/Provenance
    /// children landing in the in-memory list.
    /// </summary>
    private sealed record VerbatimCandidate(
        Guid JobId,
        Guid UserId,
        string InputContentHash,
        string? RawInputRef,
        string? InputSessionMetadataJson,
        string? TranscriptEnglish,
        string? TranscriptEnglishRedacted,
        string? TranscriptTranslit,
        string? TranscriptTranslate,
        string? TranscriptCodemix,
        string? TranscriptModelVersion);
}
