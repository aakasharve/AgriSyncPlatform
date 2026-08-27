using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Results;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Dfes.RecordQuestionEvent;

/// <summary>
/// Records ONE shown/answered D8 question.
/// </summary>
/// <remarks>
/// <para><b>Why every log line here wraps <c>QuestionKey</c> in <see cref="LogSafe.Text"/>.</b>
/// The command's own summary says it: apart from <c>CallerUserId</c>, every field "comes straight
/// from the client's selected bank entry". <c>QuestionKey</c> is therefore attacker-controlled
/// text, and a newline in it would let a client append a line to the log that looks exactly like
/// one we wrote. CodeQL flagged all four sinks below as CWE-117 on PR #55.</para>
///
/// <para>That matters here specifically, because these lines are the ONLY place three real
/// failures surface: a question that failed the both-approved gate, an answer naming a daily_log
/// that does not exist, and an answer naming another farm's log. None of the three reaches the
/// farmer and none of them fails the request — the log line IS the observer. Evidence a client can
/// write into is not evidence, so the values are defused and the lines are left intact.</para>
///
/// <para><b>Not sanitised, because it is never logged: <c>cmd.Response</c>.</b> That is the
/// farmer's own words, verbatim. <see cref="LogSafe"/> sanitises, it does not redact, and no
/// sanitiser makes farmer content safe to put in an ops log. It is persisted on the row and
/// becomes an observation; it stays out of the log sink entirely. Every other interpolated value
/// at these four sites is a <see cref="Guid"/> or a <see cref="bool"/>, neither of which can carry
/// a line break.</para>
/// </remarks>
public sealed class RecordQuestionEventHandler(
    IShramSafalRepository repository,
    IDailyRichnessDerivationService dailyRichnessDerivation,
    IClock clock,
    ILogger<RecordQuestionEventHandler> logger)
{
    public async Task<Result<Guid>> HandleAsync(RecordQuestionEventCommand cmd, CancellationToken ct = default)
    {
        if (cmd.CallerUserId == Guid.Empty || cmd.FarmId == Guid.Empty
            || string.IsNullOrWhiteSpace(cmd.QuestionKey))
        {
            return Result.Failure<Guid>(ShramSafalErrors.InvalidCommand);
        }

        // HARD GATE (defense-in-depth): never persist an unapproved question, no
        // matter what the client sent. The canonical approval list is the reviewed
        // frontend bank; this backend guard makes the invariant unforgeable.
        if (!cmd.AgronomistApproved || !cmd.MarathiApproved)
        {
            logger.LogWarning(
                "Rejected question_event {QuestionKey} for farm {FarmId}: not both-approved (agr={Agr}, mr={Mr}).",
                LogSafe.Text(cmd.QuestionKey), cmd.FarmId, cmd.AgronomistApproved, cmd.MarathiApproved);
            return Result.Failure<Guid>(ShramSafalErrors.InvalidCommand);
        }

        var isMember = await repository.IsUserMemberOfFarmAsync(cmd.FarmId, cmd.CallerUserId, ct);
        if (!isMember)
        {
            return Result.Failure<Guid>(ShramSafalErrors.Forbidden);
        }

        // wave-3.3, Ruling 1 (2026-08-15): "offline retries, reopening the app, or syncing
        // from another device must not create duplicate questions."
        //
        // Task 3.2 stopped the ENGINE asking the same question about the same log twice.
        // It cannot stop a WRITE happening twice: useDfesQuestion.ts resets recordedRef on a
        // failed POST, so a request that reaches the server and then loses the response is
        // retried against a row that already landed. This read is what makes that retry
        // silent — it returns the SAME event id, so the client's success path is identical
        // to the first call's and nothing downstream can tell them apart.
        //
        // Check-then-insert rather than an upsert, because ssf.question_events is
        // append-only BY PRIVILEGE (REVOKE UPDATE, DELETE — 20260713052440_AddDfesDataSpine):
        // ON CONFLICT DO UPDATE is not available to agrisync_app at all. The partial unique
        // index ux_question_events_log_question (20260816090000_UniqueQuestionPerLog) is the
        // backstop for the genuine concurrent race this read cannot close.
        //
        // Scoped to commands that NAME a log. A null DailyLogId has no per-log identity to
        // dedupe on — and every row written before wave-3.1 has daily_log_id NULL, which is
        // exactly why the index carries `WHERE daily_log_id IS NOT NULL`. Guarding on null
        // here would silently collapse the day-scoped context questions (crop stage,
        // previous observation) that legitimately recur.
        //
        // Placed AFTER the approval and membership gates on purpose: an unapproved or
        // non-member caller must still be rejected, never handed an existing row's id.
        if (cmd.DailyLogId is { } logId)
        {
            var existing = await repository.FindQuestionEventAsync(logId, cmd.QuestionKey, ct);
            if (existing is not null)
            {
                logger.LogInformation(
                    "Idempotent replay of question_event {QuestionKey} for log {DailyLogId}; returning existing row {EventId}.",
                    LogSafe.Text(cmd.QuestionKey), logId, existing.Id);
                return Result.Success(existing.Id);
            }
        }

        var now = clock.UtcNow;

        // wave-3.11 wiring (2026-08-16) — THE ANSWER ROUTE.
        //
        // Until this block existed, NOTHING wrote ObservationEvent.SourceQuestionId, so
        // ObservationAnchor — the whole of wave-3.11 — was unreachable code: every
        // observation the extractor ever saw took the `SourceQuestionId is null` branch
        // and was judged by the 8-character floor. The rule was installed ahead of its
        // route on purpose (that is what made it incapable of lowering an existing day);
        // this closes the gap so the rule now governs something real.
        //
        // wave-3.7 lands the farmer's spoken answer on question_events.response, keyed to
        // the log the question was ABOUT (the stashed sourceLogId), not the log he happened
        // to speak while answering. That response is a noticing he made about that day, in
        // his own words. It is turned into exactly ONE ObservationEvent on that log,
        // stamped with this question event's id — which is why the id is generated up
        // front rather than inline below: the link is closed in BOTH directions in the
        // same insert, and it has to be, because ssf.question_events is append-only by
        // privilege (REVOKE UPDATE, DELETE) so answer_observation_id can never be filled
        // in afterwards.
        //
        // Nothing is invented (doctrine P4): TextRaw is his transcript verbatim. Whether
        // it EARNS anything is not decided here — DfesLensExtractor asks ObservationAnchor,
        // and a filler answer earns zero extra and never anything less (decision 15).
        var eventId = Guid.NewGuid();
        var answerLink = await BuildAnswerObservationAsync(cmd, eventId, now, ct);
        var answerObservation = answerLink?.Observation;
        if (answerObservation is not null)
        {
            await repository.AddObservationEventAsync(answerObservation, ct);
        }

        var entity = QuestionEvent.Create(
            id: eventId, dailyLogId: cmd.DailyLogId, farmId: cmd.FarmId, plotId: cmd.PlotId,
            questionKey: cmd.QuestionKey, crop: cmd.Crop, expectedStage: cmd.ExpectedStage,
            actualStageApplicability: cmd.ActualStageApplicability, anchorDateType: cmd.AnchorDateType,
            triggerType: cmd.TriggerType, questionType: cmd.QuestionType, lens: cmd.Lens,
            depthLevel: cmd.DepthLevel, priority: cmd.Priority, cooldown: cmd.Cooldown,
            answerModes: cmd.AnswerModes, safetyClass: cmd.SafetyClass,
            agronomistApproved: cmd.AgronomistApproved, marathiApproved: cmd.MarathiApproved,
            bankVersion: cmd.BankVersion, questionEngineVersion: cmd.QuestionEngineVersion,
            answerObservationId: cmd.AnswerObservationId ?? answerObservation?.Id, shownAtUtc: cmd.ShownAtUtc,
            triggerReason: cmd.TriggerReason, weatherContext: cmd.WeatherContext,
            response: cmd.Response, stageConfirmed: cmd.StageConfirmed,
            photoSubmitted: cmd.PhotoSubmitted, skipped: cmd.Skipped, createdAtUtc: now);

        await repository.AddQuestionEventAsync(entity, ct);
        await repository.SaveChangesAsync(ct);

        // task-3 (2026-08-14), founder ruling A — the farmer just told us something true
        // about this day. The number he is looking at must reflect it before he looks
        // away; a screen that thanks him and then shows the same score teaches him that
        // answering is pointless.
        //
        // Ordering matters: the row is FLUSHED first (the SaveChanges above), because the
        // recompute reads the day's answered gaps back out of question_events with an EF
        // query and would otherwise not see it. Flushed, NOT committed — this endpoint is
        // not on TenantTransactionMiddleware's skip-list, so everything here rides the
        // per-request transaction that middleware opened and commits only once the whole
        // pipeline succeeds. That is deliberate and load-bearing: if the recompute throws,
        // the WHOLE request rolls back, the event never becomes durable, and the farmer
        // gets a loud failure instead of a 200 with a silently unmoved score. Do not
        // "harden" this with the savepoint/try-catch dance CreateDailyLogHandler uses —
        // that handler also serves /sync/push, which IS skip-listed and therefore has no
        // ambient transaction, which is the only reason it needs savepoints.
        //
        // The local day comes from the SAME rule the derivation and the repository use
        // (FarmLocalDay), off the instant the question was shown — falling back to the
        // row's own creation time when the client sent no ShownAtUtc, exactly as the
        // repository's window does. No second date source is introduced.
        var localDate = FarmLocalDay.From(entity.ShownAtUtc ?? entity.CreatedAtUtc);

        // Recompute ONLY when this event could actually credit something. The client fires
        // recordOutcome on all three outcomes — a real answer, a bare acknowledgement, and
        // a dismissal (MeterQuestionHost.tsx) — and the last two carry no response, so
        // they can move nothing. Rebuilding the day for them would turn one INSERT into a
        // full re-derivation (the day's logs, observations, per-log AI jobs, labour,
        // irrigation, machinery and disturbance rows) plus an unconditional
        // MarkUpdated/UPDATE on the aggregate, on every single card interaction.
        //
        // TryFrom is the same gate the recompute's own repository read applies, so this
        // can only ever skip work that would have changed nothing — never a real answer.
        var recomputed = false;
        if (AnsweredGap.TryFrom(cmd.QuestionKey, cmd.Response, localDate, out _))
        {
            await dailyRichnessDerivation.RecomputeAsync(cmd.FarmId, localDate, ct);
            recomputed = true;
        }

        // wave-3.11 wiring — the answer route needs its OWN recompute, and on a DIFFERENT
        // day than the gap route.
        //
        // The gap credit is keyed on the day the question was SHOWN, because that is the
        // window GetAnsweredGapsAsync reads. The observation is keyed on the day of the log
        // the question was ABOUT — wave-3.7's whole point is that Monday's gap can be
        // answered on Tuesday. Recomputing only the shown day would write the observation
        // and leave Monday's number untouched until something else happened to rebuild it,
        // which is the same "answered and nothing moved" failure founder ruling A exists to
        // prevent. Also required for non-gap keys (safety.*, followup.*) — AnsweredGap
        // returns false for those, so without this they would recompute nothing at all
        // despite having just produced a real observation.
        if (answerLink is { } link && !(recomputed && link.LogLocalDate == localDate))
        {
            await dailyRichnessDerivation.RecomputeAsync(cmd.FarmId, link.LogLocalDate, ct);
            recomputed = true;
        }

        if (recomputed)
        {
            await repository.SaveChangesAsync(ct);
        }

        return Result.Success(entity.Id);
    }

    /// <summary>
    /// The farmer's answer, as an <see cref="ObservationEvent"/> anchored to the question
    /// that prompted it. Returns <c>null</c> — writing nothing — whenever the answer cannot
    /// honestly become one.
    /// </summary>
    private async Task<AnswerLink?> BuildAnswerObservationAsync(
        RecordQuestionEventCommand cmd, Guid questionEventId, DateTime now, CancellationToken ct)
    {
        // A skip or a bare acknowledgement is SILENCE, and silence never becomes an
        // observation (doctrine P4) — the same rule AnsweredGap.TryFrom already applies to
        // the gap route, applied here to the observation route.
        if (cmd.Skipped == true || string.IsNullOrWhiteSpace(cmd.Response)) return null;

        // ObservationEvent is an EXISTS-join child of daily_logs — it cannot exist without
        // one. A question with no DailyLogId (the day-scoped context questions, and every
        // row written before wave-3.1) has no log to hang a noticing on, so it stays exactly
        // what it is today: preserved text on question_events.response, credited nothing.
        if (cmd.DailyLogId is not { } answeredLogId) return null;

        var log = await repository.GetDailyLogByIdAsync(answeredLogId, ct);
        if (log is null)
        {
            logger.LogWarning(
                "question_event {QuestionKey} names daily_log {DailyLogId}, which does not exist; "
                + "the answer is preserved on the event but produces no observation.",
                LogSafe.Text(cmd.QuestionKey), answeredLogId);
            return null;
        }

        // Cross-farm guard, mirroring DailyRichnessDerivationService's job guard. The log id
        // arrives from the client; membership was checked against cmd.FarmId, not against
        // this log. Writing a noticing into another tenant's log would be a data leak that
        // RLS would (correctly) reject at the DB — fail here instead, loudly and early.
        if (log.FarmId.Value != cmd.FarmId)
        {
            logger.LogWarning(
                "question_event {QuestionKey} names daily_log {DailyLogId} belonging to farm {LogFarmId}, "
                + "not the caller's farm {FarmId}; no observation written.",
                LogSafe.Text(cmd.QuestionKey), answeredLogId, log.FarmId.Value, cmd.FarmId);
            return null;
        }

        var observation = ObservationEvent.Create(
            id: Guid.NewGuid(),
            dailyLogId: log.Id,
            // The question's own plot when it named one; otherwise the log's. Never invented.
            plotId: cmd.PlotId ?? log.PlotId,
            // A noticing, not a tip: ObservationNoteType.Observation is what the extractor's
            // NoticingNoteTypes set recognises, and it is what an answer to Sathi actually is.
            noteType: ObservationNoteType.Observation,
            severity: ObservationSeverity.Normal,
            // wave-3.7 is the only route that produces a Response, and it is the spoken one
            // (the tap-choice branch writes no response at all). If a typed answer route is
            // ever added, the command must carry the mode rather than this defaulting.
            source: ObservationSource.Voice,
            textRaw: cmd.Response!,   // his own words, verbatim — never a summary
            textCleaned: null,
            tagsJson: null,
            linkedActivityId: null,
            createdAtUtc: now);

        // THE LINK. Everything else on the facet row is null because nothing has derived it;
        // stamping a facet we did not compute would be fabrication.
        observation.ApplyInsightEntry(
            observation: null, change: null, comparison: null, challenge: null, uncertainty: null,
            hypothesis: null, evidence: null, learning: null, nextAction: null, cropStage: null,
            farmerConfirmedSummary: null, sourceQuestionId: questionEventId);

        return new AnswerLink(observation, log.LogDate);
    }

    /// <summary>The answer observation plus the local day it belongs to (the log's, not the
    /// day the question was shown — wave-3.7 lets those differ).</summary>
    private sealed record AnswerLink(ObservationEvent Observation, DateOnly LogLocalDate);
}
