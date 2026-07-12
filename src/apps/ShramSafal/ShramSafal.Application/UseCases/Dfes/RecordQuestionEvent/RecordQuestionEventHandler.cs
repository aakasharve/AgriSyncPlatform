using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Dfes;

namespace ShramSafal.Application.UseCases.Dfes.RecordQuestionEvent;

public sealed class RecordQuestionEventHandler(
    IShramSafalRepository repository,
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
        return Result.Success(entity.Id);
    }
}
