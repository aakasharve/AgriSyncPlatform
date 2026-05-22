using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Storage;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Logs;
using ShramSafal.Infrastructure.Integrations.Sarvam;
using ShramSafal.Infrastructure.Persistence;

namespace ShramSafal.Infrastructure.AI;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.11a — selective
/// diarization worker. Periodic background scan that finds
/// <c>ssf.ai_jobs</c> rows whose linked <c>ssf.daily_logs</c> entered
/// the Trust Ladder's <see cref="VerificationStatus.Disputed"/> or
/// <see cref="VerificationStatus.CorrectionPending"/> states and adds a
/// diarized transcript onto the <c>diarized_transcript_json</c> column.
///
/// <para>
/// <b>Why diarization for disputes specifically.</b> Per ADR-DS-014 §C,
/// diarization is a paid Sarvam add-on we don't want to attach to every
/// clip. Disputed / correction-pending logs are exactly the moments where
/// "who said what" matters most (e.g. distinguishing the farmer's voice
/// from the field-worker's during a follow-up phone call). The cap is
/// administered by <c>ssf.diarization_policy</c> so the founder can
/// tune the cost per cohort.
/// </para>
///
/// <para>
/// <b>Three independent gates.</b>
/// <list type="number">
///   <item><see cref="SelectiveDiarizationOptions.Enabled"/> — env-var
///   master kill-switch (default <c>false</c>).</item>
///   <item><c>ssf.diarization_policy WHERE trigger_type='dispute_flagged'</c>
///   row exists AND <c>enabled=true</c>. Missing or disabled row → no-op.</item>
///   <item>Today's Sarvam VoiceToStructuredLog rollup spend
///   (<c>ssf.ai_provider_spend_daily</c>) is below the
///   <c>max_daily_cost_inr</c> on the diarization policy row. Worker
///   halts the current tick when the cap is reached and resumes on the
///   next tick once a new day rolls over (or a refund lands).</item>
/// </list>
/// </para>
///
/// <para>
/// <b>Speaker identity resolution OUT OF SCOPE.</b> Per Phase 4 parking
/// lot, mapping <c>speaker_label_A</c> / <c>speaker_label_B</c> to
/// concrete <c>actor_user_id</c> values is deferred. This worker
/// persists the RAW diarized array verbatim into
/// <c>diarized_transcript_json</c>; downstream consumers (admin UI /
/// audit replay) read the raw labels.
/// </para>
///
/// <para>
/// <b>Cost line.</b> Each diarized call appends a new
/// <see cref="AiJobAttempt"/> onto the parent <see cref="AiJob"/>.
/// The estimated INR cost is computed with a 1.20× multiplier on top
/// of the base codemix cost (mirrors the ≈ +20% Sarvam diarization
/// surcharge per the pricing snapshot). The
/// <see cref="AiCostBudgetGuard"/> aggregator picks the new attempt up
/// on its next rollup tick, so the diarized spend lands in
/// <c>ssf.ai_provider_spend_daily</c> under the same
/// (tenant × Sarvam × VoiceToStructuredLog × day) bucket as the
/// primary transcribe call. Envelope §Task 2.11a step 5 calls this a
/// "separate cost line per diarization call"; the separation is
/// row-per-attempt on <c>ssf.ai_job_attempts</c>, which then collapses
/// at rollup time — the rollup table itself has no operation sub-type
/// dimension.
/// </para>
/// </summary>
internal sealed class SelectiveDiarizationWorker(
    IServiceScopeFactory scopeFactory,
    IOptions<SelectiveDiarizationOptions> options,
    ILogger<SelectiveDiarizationWorker> logger,
    TimeProvider? timeProvider = null) : BackgroundService
{
    // ssf.diarization_policy row gating the worker.
    private const string DispatchTriggerType = "dispute_flagged";

    // Sarvam diarization is billed against the VoiceToStructuredLog rollup
    // (per ADR-DS-014 §C — diarization is a capability attached to the
    // existing voice pipeline, not a new operation). The "+diarization"
    // sub-type lives on the AiJobAttempt level, not the rollup level.
    private const AiOperationType BillingOperation = AiOperationType.VoiceToStructuredLog;

    // Surcharge multiplier applied to the codemix base cost to derive
    // the diarized call's estimated INR. 1.20× ≈ +20% per Sarvam's
    // public pricing snapshot for the diarization add-on (2026-05-21);
    // refresh when the matrix changes.
    private const decimal DiarizationCostMultiplier = 1.20m;

    private readonly SelectiveDiarizationOptions _options = options.Value;
    private readonly TimeProvider _timeProvider = timeProvider ?? TimeProvider.System;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.Enabled)
        {
            logger.LogInformation(
                "SelectiveDiarizationWorker disabled by configuration (Ai:SelectiveDiarization:Enabled = false). Exiting.");
            return;
        }

        var tickInterval = TimeSpan.FromMinutes(Math.Max(1, _options.TickIntervalMinutes));
        var batchSize = Math.Max(1, _options.BatchSize);
        logger.LogInformation(
            "SelectiveDiarizationWorker started. TickIntervalMinutes={Interval} BatchSize={BatchSize}.",
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
                logger.LogWarning(ex, "SelectiveDiarizationWorker tick failed. Continuing.");
            }
        }

        logger.LogInformation("SelectiveDiarizationWorker stopped.");
    }

    /// <summary>
    /// One sampling tick. <c>internal</c> so the integration test drives
    /// the worker synchronously. Returns the number of ai_jobs rows for
    /// which a diarized transcript was newly persisted.
    /// </summary>
    internal async Task<int> RunTickAsync(int batchSize, CancellationToken ct)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();

        // Gate 1 — diarization policy. Missing row OR Enabled=false → no-op.
        var policy = await db.DiarizationPolicies
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.TriggerType == DispatchTriggerType, ct)
            .ConfigureAwait(false);

        if (policy is null || !policy.Enabled)
        {
            logger.LogDebug(
                "SelectiveDiarizationWorker tick aborted — diarization_policy row '{Trigger}' missing or disabled.",
                DispatchTriggerType);
            return 0;
        }

        // Gate 2 — daily cost cap. Identical pattern to the verbatim
        // worker: the rollup table has no operation sub-type dimension,
        // so today's "Sarvam VoiceToStructuredLog" spend is the closest
        // proxy. The cap is hard-edged.
        var dailyCap = policy.MaxDailyCostInr;
        var nowUtc = _timeProvider.GetUtcNow().UtcDateTime;
        var today = DateOnly.FromDateTime(nowUtc);

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
                    "SelectiveDiarizationWorker tick aborted — today's Sarvam VoiceToStructuredLog spend {SpendInr:F2} INR has reached the diarization cap {CapInr:F2} INR. Will retry on next tick.",
                    todaySpend,
                    dailyCap.Value);
                return 0;
            }
        }

        // Candidate query — daily_logs whose CURRENT verification status
        // is Disputed or CorrectionPending. We model "current status" as
        // the latest verification_event by occurred_at_utc (Phase 7 FSM
        // convention). The corresponding ai_job is linked via
        // daily_logs.source_ai_job_id (Phase 1 schema, mapped on
        // DailyLogConfiguration); we only diarize ai_jobs that
        // (a) still lack diarized_transcript_json, (b) used Sarvam, and
        // (c) carry an input_content_hash so we can re-pull the audio.
        var candidates = await (
                from log in db.Set<DailyLog>().AsNoTracking()
                join job in db.AiJobs.AsNoTracking() on log.SourceAiJobId equals job.Id
                where job.DiarizedTranscriptJson == null
                      && job.TranscriptProvider == "Sarvam"
                      && job.Status == AiJobStatus.Succeeded
                      && job.InputContentHash != null
                      && log.VerificationEvents
                          .OrderByDescending(v => v.OccurredAtUtc)
                          .Select(v => v.Status)
                          .FirstOrDefault() == VerificationStatus.Disputed
                          ||
                          log.VerificationEvents
                              .OrderByDescending(v => v.OccurredAtUtc)
                              .Select(v => v.Status)
                              .FirstOrDefault() == VerificationStatus.CorrectionPending
                select new DiarizationCandidate(
                    job.Id,
                    job.InputContentHash!,
                    job.InputSpeechDurationMs,
                    job.InputRawDurationMs,
                    job.TranscriptModelVersion))
            .Distinct()
            .Take(batchSize)
            .ToListAsync(ct)
            .ConfigureAwait(false);

        if (candidates.Count == 0)
        {
            logger.LogDebug("SelectiveDiarizationWorker tick — no candidate rows.");
            return 0;
        }

        var sttClient = scope.ServiceProvider.GetRequiredService<SarvamSttClient>();
        var rawBlobStore = scope.ServiceProvider.GetRequiredService<IRawBlobStore>();
        var costEstimator = scope.ServiceProvider.GetRequiredService<AiAttemptCostEstimator>();

        var updated = 0;
        foreach (var candidate in candidates)
        {
            if (ct.IsCancellationRequested)
            {
                break;
            }

            // Re-pull the cold-tier audio bytes. Same content-addressed
            // hash as InputContentHash on the AiJob row.
            Stream? audioStream;
            try
            {
                audioStream = await rawBlobStore.GetAsync(candidate.InputContentHash, ct).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                logger.LogDebug(ex,
                    "SelectiveDiarizationWorker skipping job {JobId} — raw audio blob not retrievable (hash={Hash}).",
                    candidate.JobId,
                    candidate.InputContentHash);
                continue;
            }

            if (audioStream is null)
            {
                logger.LogDebug(
                    "SelectiveDiarizationWorker skipping job {JobId} — raw blob store returned null stream.",
                    candidate.JobId);
                continue;
            }

            await using var ownedStream = audioStream;

            // Sarvam call with diarization toggled on. Mode stays
            // "codemix" (the orchestrator's default) — diarization is a
            // separate capability attached to whatever mode the caller
            // requests. Language hint blank → SarvamSttClient falls
            // back to SarvamOptions.SttLanguage (mr-IN default).
            var sttResult = await sttClient
                .TranscribeAsync(
                    ownedStream,
                    mimeType: string.Empty,
                    languageHint: null,
                    withDiarization: true,
                    ct: ct)
                .ConfigureAwait(false);

            if (!sttResult.IsSuccess)
            {
                logger.LogWarning(
                    "SelectiveDiarizationWorker: Sarvam diarized call failed for job {JobId} (hash={Hash}) — {Error}",
                    candidate.JobId,
                    candidate.InputContentHash,
                    sttResult.Error);
                continue;
            }

            if (string.IsNullOrWhiteSpace(sttResult.DiarizedTranscriptJson))
            {
                // The call succeeded but Sarvam returned no diarized
                // array (e.g. single-speaker clip below their threshold).
                // We do NOT persist a sentinel "we asked but got nothing"
                // value — the column stays null and the candidate will
                // re-enter the next tick. For long-tail no-diar audio
                // the dispute_flagged row eventually times out of the
                // candidate set when its verification transitions out
                // of Disputed/CorrectionPending; no infinite retry
                // because the cost cap halts the tick.
                logger.LogDebug(
                    "SelectiveDiarizationWorker: Sarvam returned no diarized payload for job {JobId}; skipping.",
                    candidate.JobId);
                continue;
            }

            // Load the writable AiJob aggregate (Include Attempts because
            // AddAttempt rehydrates from the navigation collection).
            var jobForUpdate = await db.AiJobs
                .Include(j => j.Attempts)
                .FirstOrDefaultAsync(j => j.Id == candidate.JobId, ct)
                .ConfigureAwait(false);

            if (jobForUpdate is null)
            {
                continue;
            }

            // Stamp a new attempt so AiCostBudgetGuard rolls the
            // diarization spend into ai_provider_spend_daily on its
            // next tick. The "+diarization" sub-type is implicit in
            // the multiplier; no string discriminator on the attempt
            // because the existing AiJobAttempt shape has no
            // free-form column for it.
            var diarizedAttempt = jobForUpdate.AddAttempt(
                provider: AiProviderType.Sarvam,
                requestPayloadHash: candidate.InputContentHash);
            diarizedAttempt.RecordSuccess(
                rawResponse: string.Empty,
                latencyMs: 0,
                tokens: null,
                confidence: null);

            var baseCost = costEstimator.EstimateUnits(
                provider: AiProviderType.Sarvam,
                operation: BillingOperation,
                payloadBytes: 0,
                inputSpeechDurationMs: candidate.InputSpeechDurationMs,
                inputRawDurationMs: candidate.InputRawDurationMs);
            var diarizedCost = decimal.Round(
                baseCost * DiarizationCostMultiplier,
                4,
                MidpointRounding.AwayFromZero);
            diarizedAttempt.SetEstimatedCostUnits(diarizedCost);

            // Persist the raw diarized array via the dedicated mutator
            // authored in Phase 1.1. Trimming + null/empty handling
            // already live inside SetDiarizedTranscript.
            jobForUpdate.SetDiarizedTranscript(sttResult.DiarizedTranscriptJson);

            updated++;
        }

        if (updated > 0)
        {
            await db.SaveChangesAsync(ct).ConfigureAwait(false);
            logger.LogInformation(
                "SelectiveDiarizationWorker: persisted {Count} diarized transcript(s) on this tick.",
                updated);
        }

        return updated;
    }

    /// <summary>
    /// Lightweight projection used by the candidate query — held in
    /// memory between the LINQ probe and the writable load.
    /// </summary>
    private sealed record DiarizationCandidate(
        Guid JobId,
        string InputContentHash,
        int? InputSpeechDurationMs,
        int? InputRawDurationMs,
        string? TranscriptModelVersion);
}
