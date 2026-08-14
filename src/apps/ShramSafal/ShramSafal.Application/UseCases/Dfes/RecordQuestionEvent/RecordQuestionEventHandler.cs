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
        // Ordering matters: the event is COMMITTED first, because the recompute reads the
        // day's answered gaps back out of question_events. RecomputeAsync rebuilds the
        // whole (farm, date) aggregate from scratch and is safe to call any number of
        // times (see IDailyRichnessDerivationService) — and it no-ops when the day has no
        // log at all, so answering about a day the farmer never recorded invents nothing.
        //
        // The local day comes from the SAME rule the derivation and the repository use
        // (FarmLocalDay), off the instant the question was shown — falling back to the
        // row's own creation time when the client sent no ShownAtUtc, exactly as the
        // repository's window does. No second date source is introduced.
        var localDate = FarmLocalDay.From(entity.ShownAtUtc ?? entity.CreatedAtUtc);
        await dailyRichnessDerivation.RecomputeAsync(cmd.FarmId, localDate, ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success(entity.Id);
    }
}
