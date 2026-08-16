using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Dfes;

namespace ShramSafal.Application.UseCases.Dfes.RecordQuestionEvent;

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
                cmd.QuestionKey, cmd.FarmId, cmd.AgronomistApproved, cmd.MarathiApproved);
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
                    cmd.QuestionKey, logId, existing.Id);
                return Result.Success(existing.Id);
            }
        }

        var now = clock.UtcNow;
        var entity = QuestionEvent.Create(
            id: Guid.NewGuid(), dailyLogId: cmd.DailyLogId, farmId: cmd.FarmId, plotId: cmd.PlotId,
            questionKey: cmd.QuestionKey, crop: cmd.Crop, expectedStage: cmd.ExpectedStage,
            actualStageApplicability: cmd.ActualStageApplicability, anchorDateType: cmd.AnchorDateType,
            triggerType: cmd.TriggerType, questionType: cmd.QuestionType, lens: cmd.Lens,
            depthLevel: cmd.DepthLevel, priority: cmd.Priority, cooldown: cmd.Cooldown,
            answerModes: cmd.AnswerModes, safetyClass: cmd.SafetyClass,
            agronomistApproved: cmd.AgronomistApproved, marathiApproved: cmd.MarathiApproved,
            bankVersion: cmd.BankVersion, questionEngineVersion: cmd.QuestionEngineVersion,
            answerObservationId: cmd.AnswerObservationId, shownAtUtc: cmd.ShownAtUtc,
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
        if (AnsweredGap.TryFrom(cmd.QuestionKey, cmd.Response, localDate, out _))
        {
            await dailyRichnessDerivation.RecomputeAsync(cmd.FarmId, localDate, ct);
            await repository.SaveChangesAsync(ct);
        }

        return Result.Success(entity.Id);
    }
}
