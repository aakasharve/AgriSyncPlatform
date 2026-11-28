using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Results;
using Microsoft.Extensions.Logging;
using System.Text.Json;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Inputs.AssertInputIdentity;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Inputs;

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
    ILogger<RecordQuestionEventHandler> logger,
    IQuestionSourceResolver? sourceResolver = null,
    // slice 12: the sources of a stage question come from the task the plot follows or owns; the embedded schedule above is the fallback only.
    ITaskQuestionSources? taskSources = null)
{
    private static readonly HashSet<string> PromptOrigins = new(StringComparer.Ordinal) { "bank", "pattern", "ai" };
    private const int MaxPromptTextLength = 600;
    private const int MaxScheduleCardRefLength = 200;

    public async Task<Result<Guid>> HandleAsync(RecordQuestionEventCommand cmd, CancellationToken ct = default)
    {
        if (cmd.CallerUserId == Guid.Empty || cmd.FarmId == Guid.Empty
            || string.IsNullOrWhiteSpace(cmd.QuestionKey))
        {
            return Result.Failure<Guid>(ShramSafalErrors.InvalidCommand);
        }

        // Lane DFES-Q (founder D-B, 2026-11-21): the agronomist flag no longer gates — no agronomist ever reviewed this copy,
        // and the founder replaced that flag with a SOURCE. Two gates remain, both decided here and not by the phone:
        //  1. approved copy: text from the bank or a pattern must be Marathi-approved; AI-worded text is checked by the
        //     server's own guard where it is written, so it carries no Marathi tick.
        //  2. the source gate: a question that states agronomy (the server decides from the key) is recorded only with sources
        //     the server resolved from Shram Safal's own published schedule. The phone sends look-line ids, never a source.
        var origin = cmd.PromptOrigin;
        if (origin is not null && !PromptOrigins.Contains(origin))
        {
            return Result.Failure<Guid>(ShramSafalErrors.InvalidCommand);
        }

        if (origin != "ai" && !cmd.MarathiApproved)
        {
            logger.LogWarning(
                "Rejected question_event {QuestionKey} for farm {FarmId}: copy not Marathi-approved (origin={Origin}).",
                LogSafe.Text(cmd.QuestionKey), cmd.FarmId, LogSafe.Text(origin ?? "bank"));
            return Result.Failure<Guid>(ShramSafalErrors.InvalidCommand);
        }

        var kind = QuestionKinds.ForKey(cmd.QuestionKey);
        var isProductPurpose = kind == QuestionKinds.ProductPurpose;

        // Part 03 B4 — the product slot, the answer mode and the chip code belong to the product-purpose question alone.
        if (!isProductPurpose
            && (cmd.InputEventId is not null || cmd.MixIndex is not null || cmd.AnswerMode is not null || cmd.AnswerCode is not null))
        {
            return Result.Failure<Guid>(ShramSafalErrors.InvalidCommand);
        }

        string? sourceRefsJson = null;
        if (QuestionKinds.StatesAgronomy(kind))
        {
            var sources = await ResolveSourcesAsync(cmd, ct);
            if (sources is not { Count: > 0 })
            {
                logger.LogWarning(
                    "Rejected question_event {QuestionKey} for farm {FarmId}: it states agronomy (kind={Kind}) and no source resolved.",
                    LogSafe.Text(cmd.QuestionKey), cmd.FarmId, kind);
                return Result.Failure<Guid>(ShramSafalErrors.InvalidCommand);
            }

            sourceRefsJson = JsonSerializer.Serialize(
                sources.Select(s => new { lineId = s.LineId, docId = s.DocId, page = s.Page }));
        }

        if ((cmd.DeviationReasonCode is not null && !DeviationReasons.IsKnown(cmd.DeviationReasonCode))
            || cmd.DeviationChallenge?.Length > DeviationReasons.MaxChallengeLength
            || cmd.PromptText?.Length > MaxPromptTextLength
            || cmd.ScheduleCardRef?.Length > MaxScheduleCardRefLength)
        {
            return Result.Failure<Guid>(ShramSafalErrors.InvalidCommand);
        }

        var isMember = await repository.IsUserMemberOfFarmAsync(cmd.FarmId, cmd.CallerUserId, ct);
        if (!isMember)
        {
            return Result.Failure<Guid>(ShramSafalErrors.Forbidden);
        }

        if (isProductPurpose)
        {
            return await RecordProductPurposeAsync(cmd, origin, kind, ct);
        }

        // spec: plr-d10 lane PRV fix pass 1 (H2) — a question about a record kept from him is not his to answer.
        if (cmd.DailyLogId is { } aboutLogId
            && await repository.GetDailyLogByIdAsync(aboutLogId, ct) is { } aboutLog
            && !await Services.RecordAudienceGate.MaySeeLogAsync(repository, aboutLog, cmd.CallerUserId, clock.UtcNow, ct))
        {
            return Result.Failure<Guid>(ShramSafalErrors.RecordAudienceClosed);
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
            photoSubmitted: cmd.PhotoSubmitted, skipped: cmd.Skipped, createdAtUtc: now,
            context: new QuestionEventContext(
                AskedUserId: cmd.CallerUserId, // the person asked is the caller, never a value from the body (founder D-D)
                PromptText: string.IsNullOrWhiteSpace(cmd.PromptText) ? null : cmd.PromptText.Trim(),
                PromptOrigin: origin,
                QuestionKind: kind,
                SourceRefsJson: sourceRefsJson,
                ScheduleCardRef: string.IsNullOrWhiteSpace(cmd.ScheduleCardRef) ? null : cmd.ScheduleCardRef.Trim(),
                DeviationReasonCode: cmd.DeviationReasonCode,
                DeviationChallenge: string.IsNullOrWhiteSpace(cmd.DeviationChallenge) ? null : cmd.DeviationChallenge.Trim(),
                PhotoAttachmentId: cmd.PhotoAttachmentId));

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
    /// Part 03 B4 (founder's final design, 28 Nov 2026) — his answer to "what was this product for?" about ONE product of ONE
    /// saved record (<see cref="ProductPurpose"/>).
    ///
    /// <list type="number">
    /// <item><b>Only a real answer is stored.</b> Words that carry something, by chip or by voice. A skip or a let-go after his
    /// four tries is never sent and never stored, so the product can still be answered later and silence never scores (P4).</item>
    /// <item><b>Which record, which product.</b> The record the command names, on the caller's farm (another farm's is "not
    /// found", E4). The product is a slot of the record's LATEST stored content; its name is copied from there, never from the
    /// request. The SERVER writes the stored key <c>product.purpose:{slot}:{event}</c>, so the existing unique index on
    /// (daily_log_id, question_key) holds one answer per product.</item>
    /// <item><b>Who answers.</b> The record's speaker, or a holder of the confirm-records authority (the D-95 standing of the
    /// product's other answer), who may see the record and its plot. The person asked is the caller, never a value from the body
    /// (founder D-D). How he answered (chip or voice) and the chip's code are kept with the words (P8).</item>
    /// <item><b>The first answer stands (P3).</b> The same answer again is the stored row (an offline retry); a different one is
    /// refused (<see cref="ShramSafalErrors.ProductPurposeAlreadyAnswered"/>), never silently dropped.</item>
    /// <item><b>Never an edit of the record.</b> The record's content, version, quantities and confirmation are not read for
    /// writing and not touched (P7), so it stays open after any change window on the record. It is not turned into an
    /// observation: what a product was for is not something he saw in the field (E7).</item>
    /// <item><b>The score follows a real answer.</b> The record's WORK day is recomputed (its PURPOSE part, dfes-6) in this
    /// request's transaction, so the answer and the number commit together or not at all. A "माहीत नाही" chip is stored as his
    /// answer and moves nothing.</item>
    /// </list>
    /// </summary>
    private async Task<Result<Guid>> RecordProductPurposeAsync(
        RecordQuestionEventCommand cmd, string? origin, string kind, CancellationToken ct)
    {
        var response = cmd.Response?.Trim();
        var code = cmd.AnswerCode;
        if (!string.Equals(cmd.QuestionKey.Trim(), ProductPurpose.QuestionKey, StringComparison.Ordinal)
            || cmd.DailyLogId is not { } logId || logId == Guid.Empty
            || string.IsNullOrWhiteSpace(cmd.InputEventId) || cmd.InputEventId.Trim().Length > InputIdentityAssertion.MaxInputEventId
            || cmd.MixIndex is not { } slot || slot < 0
            || !ProductPurposeAnswerModes.IsKnown(cmd.AnswerMode)
            || cmd.Skipped == true
            || string.IsNullOrEmpty(response) || response.Length > ProductPurpose.MaxResponseLength
            || (code is not null && (cmd.AnswerMode != ProductPurposeAnswerModes.Chip || !ProductPurpose.IsWellFormedCode(code)))
            // Nothing of another question rides on this one.
            || cmd.ScheduleCardRef is not null || cmd.DeviationReasonCode is not null || cmd.DeviationChallenge is not null
            || cmd.PhotoAttachmentId is not null || cmd.AnswerObservationId is not null || cmd.LookLineIds is { Count: > 0 })
        {
            return Result.Failure<Guid>(ShramSafalErrors.InvalidCommand);
        }

        var inputEventId = cmd.InputEventId.Trim();
        var storedKey = ProductPurpose.KeyFor(inputEventId, slot);
        if (storedKey.Length > ProductPurpose.MaxStoredKeyLength)
        {
            return Result.Failure<Guid>(ShramSafalErrors.InvalidCommand);
        }

        // E4 — the record is the caller's farm's; another farm's record (or none) is "not found".
        var log = await repository.GetDailyLogByIdAsync(logId, ct);
        if (log is null || (Guid)log.FarmId != cmd.FarmId)
        {
            return Result.Failure<Guid>(ShramSafalErrors.DailyLogNotFound);
        }

        var now = clock.UtcNow;
        var caller = cmd.CallerUserId;
        if (!await Services.RecordAudienceGate.MaySeeLogAsync(repository, log, caller, now, ct))
        {
            return Result.Failure<Guid>(ShramSafalErrors.RecordAudienceClosed);
        }

        if (await Services.PlotScopeGate.RefuseAsync(repository, cmd.FarmId, log.PlotId, caller, now, ct) is { } outsidePlots)
        {
            return Result.Failure<Guid>(outsidePlots);
        }

        if (caller != log.OperatorUserId.Value
            && !await Services.FarmAuthorityGate.HoldsAsync(repository, cmd.FarmId, caller, FarmAuthority.ConfirmRecords, now, ct))
        {
            return Result.Failure<Guid>(ShramSafalErrors.Forbidden);
        }

        // The first answer stands. Placed after every gate: a caller who may not answer is never handed an existing row's id.
        var existing = await repository.FindQuestionEventAsync(log.Id, storedKey, ct);
        if (existing is not null)
        {
            return string.Equals(existing.Response?.Trim(), response, StringComparison.Ordinal)
                && string.Equals(existing.AnswerMode, cmd.AnswerMode, StringComparison.Ordinal)
                && string.Equals(existing.AnswerCode, code, StringComparison.Ordinal)
                    ? Result.Success(existing.Id)
                    : Result.Failure<Guid>(ShramSafalErrors.ProductPurposeAlreadyAnswered);
        }

        // The product's name comes from the STORED record, never from the request (P1, P7).
        var content = await repository.GetCurrentDailyLogContentAsync(log.Id, ct);
        if (content is null || content.FarmId != log.FarmId)
        {
            return Result.Failure<Guid>(Error.Validation(
                AssertInputIdentityHandler.InvalidPayloadCode, "The record holds no such product."));
        }

        var spoken = AssertInputIdentityHandler.SpokenNameOf(content.DocumentJson, inputEventId, slot);
        if (spoken.IsFailure)
        {
            return Result.Failure<Guid>(spoken.Error);
        }

        var entity = QuestionEvent.Create(
            id: Guid.NewGuid(), dailyLogId: log.Id, farmId: cmd.FarmId, plotId: log.PlotId,
            questionKey: storedKey, crop: cmd.Crop, expectedStage: cmd.ExpectedStage,
            actualStageApplicability: cmd.ActualStageApplicability, anchorDateType: cmd.AnchorDateType,
            triggerType: cmd.TriggerType, questionType: cmd.QuestionType, lens: cmd.Lens,
            depthLevel: cmd.DepthLevel, priority: cmd.Priority, cooldown: cmd.Cooldown,
            answerModes: cmd.AnswerModes, safetyClass: cmd.SafetyClass,
            agronomistApproved: cmd.AgronomistApproved, marathiApproved: cmd.MarathiApproved,
            bankVersion: cmd.BankVersion, questionEngineVersion: cmd.QuestionEngineVersion,
            answerObservationId: null, shownAtUtc: cmd.ShownAtUtc,
            triggerReason: cmd.TriggerReason, weatherContext: cmd.WeatherContext,
            response: response, stageConfirmed: cmd.StageConfirmed,
            photoSubmitted: cmd.PhotoSubmitted, skipped: cmd.Skipped, createdAtUtc: now,
            context: new QuestionEventContext(
                AskedUserId: caller,
                PromptText: string.IsNullOrWhiteSpace(cmd.PromptText) ? null : cmd.PromptText.Trim(),
                PromptOrigin: origin,
                QuestionKind: kind,
                AnswerMode: cmd.AnswerMode,
                AnswerCode: code,
                ProductName: ProductPurpose.KeptName(spoken.Value!)));

        await repository.AddQuestionEventAsync(entity, ct);
        await repository.SaveChangesAsync(ct);

        // Flushed, not committed: the recompute reads the answer back with an EF query and rides the same request transaction
        // (see the gap route below for why that is load-bearing). Only an answer that tells the purpose can move the number.
        var asStored = ProductPurposeReader.ToAnswers([entity]);
        if (asStored.Count == 1 && ProductPurpose.Counts(asStored[0]))
        {
            await dailyRichnessDerivation.RecomputeAsync(cmd.FarmId, log.LogDate, ct);
            await repository.SaveChangesAsync(ct);
        }

        return Result.Success(entity.Id);
    }

    /// <summary>
    /// Slice 12 - the sources of the look lines a stage question names. A plot that follows a schedule written in the task format, or has works of its own, answers from
    /// those tasks (a line is <c>task:{key}:look</c> or <c>:ask</c>); the embedded schedule answers ONLY for a plot with neither. All or nothing; null = refused.
    /// </summary>
    private async Task<IReadOnlyList<QuestionSourceRef>?> ResolveSourcesAsync(RecordQuestionEventCommand cmd, CancellationToken ct)
    {
        if (cmd.LookLineIds is not { Count: > 0 } lineIds)
        {
            return null;
        }

        var task = taskSources is null
            ? new TaskQuestionResolution(TaskQuestionGate.NotTaskFormat)
            : await taskSources.ResolveAsync(cmd.FarmId, cmd.PlotId, lineIds, ct);
        return task.Gate switch
        {
            TaskQuestionGate.Resolved => task.Sources,
            TaskQuestionGate.Refused => null,
            _ => lineIds.Any(Domain.Dfes.TaskQuestionLines.IsTaskLine) ? null : sourceResolver?.Resolve(lineIds),
        };
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
