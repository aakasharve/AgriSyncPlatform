using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Logs.Content;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.UseCases.Logs.ReviseLogContent;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (lane F1) — an edit to what Sathi understood
/// reaches the server, instead of living on one phone (doctrine P10).
///
/// <list type="bullet">
/// <item><b>Who may.</b> The person who recorded the log, or anyone the ONE labour permission
/// system allows (<see cref="LabourManagementGate"/>: owner tier by role, जबाबदारी grant holders).
/// No second permission system. Anyone else: Forbidden, nothing written.</item>
/// <item><b>Never at the हजेरी door (review N12).</b> A record saved there holds labour only
/// (B002): its details are refused with a three-segment <c>.InvalidCommand</c>, so the phone parks
/// the queued edit where the farmer sees it instead of dropping it.</item>
/// <item><b>History, never mutation (P3).</b> A change is a NEW row at the next record version;
/// the earlier row stays exactly as it was. An identical document writes nothing and moves no
/// version (the "only if something actually moved" rule of <c>CorrectLabourHandler</c>).</item>
/// <item><b>His words survive an edit by someone who could not see them (review S1).</b> A member
/// who may not hear the words (<see cref="RecordWordsGate"/>) was sent the document without them,
/// so their absence from his edit is not a deletion: they are carried onto the new version.</item>
/// <item><b>A stale base is kept, never dropped.</b> When the editor saw an older version than the
/// record now has, the edit is still appended (both versions are kept) and the audit row says so:
/// a queued edit is the farmer's own intent and is never silently lost (P10).</item>
/// <item><b>A lost race is re-applied on top (review N1).</b> When another edit takes the same
/// record version first, the server re-reads the record and appends this edit after it — the
/// phone's retry budget is not spent on a race it did not cause.</item>
/// <item><b>It re-opens a confirmed day (lane L6).</b> What the record says changed, so a
/// confirmation that covered the old version no longer covers it: an <c>Edit</c> marker takes it
/// back to Draft. When the editor is the log's own creator and his server-derived role may confirm
/// his own saves, the day is re-confirmed at the NEW version (the <c>AddLogTaskHandler</c> rule);
/// everyone else's edit waits in the owner's inbox. Naming people stays on the labour route and
/// re-opens nothing (P7).</item>
/// <item><b>Task lines.</b> Old phones and every server reader of <c>LogTask</c> get a line for
/// each item that is NEW in this version (<see cref="TaskLines"/>), each with its <c>TaskAdded</c>
/// audit row. No line is deleted: there is no delete path (P3).</item>
/// <item><b>Its money follows (lane OF-M, F89).</b> A changed price corrects the line's money, a removed one corrects
/// it to nothing, a newly priced line gets money under its derived id on the record's place and day — or the answer
/// says why it could not (<see cref="EditMoney"/>). The answer names exactly that money
/// (<see cref="ReviseLogContentResultDto"/>); the phone writes only it.</item>
/// </list>
/// </summary>
public sealed class ReviseLogContentHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock,
    IEntitlementPolicy entitlementPolicy,
    IScheduleComplianceService complianceService,
    ILogger<ReviseLogContentHandler> logger,
    // The money consequence, exactly as AddLogTaskHandler: a log that leaves Verified must
    // withdraw a payout authorisation granted on the strength of it. Optional for direct tests.
    Work.Handlers.OnLogVerifiedAutoVerifyJobCard? logVerificationChanged = null)
    : IHandler<ReviseLogContentCommand, ReviseLogContentResultDto>
{
    /// <summary>How many times a revision that lost the race for its version is re-applied on top.</summary>
    internal const int MaxAttempts = 3;

    public async Task<Result<ReviseLogContentResultDto>> HandleAsync(ReviseLogContentCommand command, CancellationToken ct = default)
    {
        if (command.DailyLogId == Guid.Empty || command.ActorUserId == Guid.Empty || command.BaseVersion < 1)
        {
            return Result.Failure<ReviseLogContentResultDto>(ShramSafalErrors.InvalidCommand);
        }

        // The document is checked BEFORE anything is read for writing, so a refusal stages nothing.
        if (Problem(command.ContentJson) is { } problem)
        {
            logger.LogWarning("revise_log_content for {LogId} refused: {Problem}", command.DailyLogId, problem);
            return Result.Failure<ReviseLogContentResultDto>(ShramSafalErrors.LogContentInvalid);
        }

        for (var attempt = 1; ; attempt++)
        {
            var outcome = await ReviseAsync(command, ct);
            if (outcome is not null)
            {
                return outcome;
            }

            if (attempt >= MaxAttempts)
            {
                logger.LogWarning(
                    "revise_log_content for {LogId} lost the race for its version {Attempts} times; refused as a conflict.",
                    command.DailyLogId, attempt);
                return Result.Failure<ReviseLogContentResultDto>(ShramSafalErrors.LogContentVersionConflict);
            }

            logger.LogInformation(
                "revise_log_content for {LogId}: another edit took the version first; re-applying on top (attempt {Attempt}).",
                command.DailyLogId, attempt + 1);
        }
    }

    /// <summary>The structural refusal reason for a document, or null when it is acceptable.</summary>
    private string? Problem(string contentJson)
    {
        try
        {
            using var parsed = JsonDocument.Parse(contentJson);
            return LogContentDocument.Validate(parsed.RootElement);
        }
        catch (JsonException ex)
        {
            logger.LogWarning(ex, "revise_log_content: the content document is not JSON.");
            return "content is not JSON.";
        }
    }

    /// <summary>One attempt. <c>null</c> = another edit took this version first; try again on top.</summary>
    private async Task<Result<ReviseLogContentResultDto>?> ReviseAsync(ReviseLogContentCommand command, CancellationToken ct)
    {
        var log = await repository.GetDailyLogByIdAsync(command.DailyLogId, ct);
        if (log is null)
        {
            return Result.Failure<ReviseLogContentResultDto>(ShramSafalErrors.DailyLogNotFound);
        }

        // E4 — the farm is the LOG's farm, read here; nothing in the payload names one.
        var farmId = (Guid)log.FarmId;
        var now = clock.UtcNow;
        var isCreator = command.ActorUserId == log.OperatorUserId.Value;

        // Who may: the ONE rule for changing a saved record, shared with move_daily_log (lane OF-S).
        if (await LogEditGate.CheckAsync(repository, entitlementPolicy, log, command.ActorUserId, now, ct) is { } refusal)
        {
            if (refusal.Code == ShramSafalErrors.LabourDoorLogContent.Code)
            {
                logger.LogWarning(
                    "revise_log_content for {LogId} refused: the record was saved at the labour door (B002).", log.Id);
            }

            return Result.Failure<ReviseLogContentResultDto>(refusal);
        }

        // Authority and the words rule read the role from the DATABASE, never from command.ActorRole.
        var actorRole = await repository.GetUserRoleForFarmAsync(farmId, command.ActorUserId, ct);
        var current = await repository.GetCurrentDailyLogContentAsync(log.Id, ct);

        var documentJson = command.ContentJson;
        // lane MU-3 fix 2 (N2; P7) — was his copy trimmed of its amounts? YES when his phone says so (amountsWithheld:
        // true — the pull's projection, or the purge of a copy held from before MU-3), OR when his seat cannot see the
        // farm's money NOW (a copy trimmed by an older phone's purge that did not say so, an edit from 1.0.17, an
        // explicit "false" the phone could not know better). Either way their absence from his edit is not a
        // deletion: they are carried (both are safe — a seat that cannot see money cannot have meant to change it).
        // His OWN record was never trimmed. No per-person wage lives in the content document (labour is its own path,
        // and no labour correction writes a wage), so see money is the whole question here.
        var editorScope = current is null || isCreator
            ? null
            : await FarmReadGate.ScopeAsync(repository, farmId, command.ActorUserId, now, ct);
        var copyWithoutAmounts = current is not null
            && !isCreator
            && (command.AmountsWithheld == true || editorScope?.SeeMoney != true);
        // lane MU-3 fix 1 (F3) / fix 2 (N4 = D-67) — his copy came WITHOUT the record's words when his phone says so
        // (wordsWithheld), when he may not hear words at all (RecordWordsGate), or when the record mentions money and his
        // seat does not see wages now: their absence from his edit is not a deletion either.
        var wordsNotSent = current is not null
            && (command.WordsWithheld == true
                || !await RecordWordsGate.MayHearAsync(
                    command.ActorUserId,
                    log.OperatorUserId.Value,
                    actorRole,
                    () => FarmAuthorityGate.HoldsAsync(
                        repository, farmId, command.ActorUserId, Domain.Farms.FarmAuthority.ConfirmRecords, now, ct))
                || (!isCreator
                    && !MoneyMention.HearsMoneyWords(editorScope)
                    && await MoneyMention.InStoredRecordAsync(repository, log, ct)));
        if (current is not null && wordsNotSent)
        {
            documentJson = LogContentDocument.CarryWordsForward(current.DocumentJson, command.ContentJson);
            if (Problem(documentJson) is { } carried)
            {
                // Only the size cap can refuse here: his words plus this edit no longer fit.
                logger.LogWarning("revise_log_content for {LogId} refused after carrying the words forward: {Problem}", log.Id, carried);
                return Result.Failure<ReviseLogContentResultDto>(ShramSafalErrors.LogContentInvalid);
            }
        }

        var wordsCarried = !ReferenceEquals(documentJson, command.ContentJson);

        // lane MU-3 (founder D-22 / D-26; fix 1 F8) — the editor's copy was sent WITHOUT its amounts (his
        // phone says so: AmountsWithheld), so their absence from his edit is not a deletion: they are carried
        // onto the new version, as his words are. Decided by what his phone was SENT, never by the authority he
        // holds by the time the edit arrives — a see-money switched on while the edit waited must not turn the
        // missing amounts into "no longer spent". The maker's own record was never sent without them.
        if (current is not null && copyWithoutAmounts)
        {
            documentJson = LogContentDocument.CarryMoneyForward(current.DocumentJson, documentJson);
            if (Problem(documentJson) is { } carriedMoney)
            {
                // Only the size cap can refuse here: the record's amounts plus this edit no longer fit.
                logger.LogWarning("revise_log_content for {LogId} refused after carrying the amounts forward: {Problem}", log.Id, carriedMoney);
                return Result.Failure<ReviseLogContentResultDto>(ShramSafalErrors.LogContentInvalid);
            }
        }

        // lane OF-M — its prices (fix passes 3 and 5), asked FIRST, so a refusal stages nothing: a seat that may not change
        // them is refused only for a real change of a price; an edit made on an older version takes the current prices.
        var editMoney = new EditMoney(repository, idGenerator, entitlementPolicy, logger);
        var prices = await editMoney.CheckPricesAsync(log, current?.DocumentJson, command.BaseVersion, documentJson, command.ActorUserId, now, ct);
        if (prices.IsFailure || prices.Value is not { } priceCheck)
        {
            return Result.Failure<ReviseLogContentResultDto>(prices.Error);
        }

        documentJson = priceCheck.DocumentJson;
        if (priceCheck.PricesCarried && Problem(documentJson) is { } carriedPrices)
        {
            // Only the size cap can refuse here: the record's prices plus this edit no longer fit.
            logger.LogWarning("revise_log_content for {LogId} refused after carrying the prices forward: {Problem}", log.Id, carriedPrices);
            return Result.Failure<ReviseLogContentResultDto>(ShramSafalErrors.LogContentInvalid);
        }

        if (current is not null)
        {
            using var incoming = JsonDocument.Parse(documentJson);
            if (LogContentDocument.SameDocument(current.DocumentJson, incoming.RootElement))
            {
                // Nothing moved: no row, no version, no re-open, no money — the edit is already what is stored.
                return Result.Success(await ForReaderAsync(new ReviseLogContentResultDto(log.ToDto(), [], [], []), log, command.ActorUserId, now, ct));
            }
        }

        var fromVersion = log.ContentVersion;
        var staleBase = command.BaseVersion < fromVersion;
        var appVersion = string.IsNullOrWhiteSpace(command.ClientAppVersion)
            ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
            : command.ClientAppVersion;

        var stamp = new ContentAuditStamp(
            command.ActorUserId,
            command.ActorRole,
            command.ClientRequestId,
            appVersion,
            command.AuditDeviceId,
            command.AuditIpHash);

        // lane OF-M — its money (fix pass 3, call 2): for a seat that may change its prices, ALL of it is brought in line with
        // what the record now states, the corrections staged with the version (one commit), new money right after it.
        var money = priceCheck.MoneyFollows
            ? await editMoney.StageAsync(log, documentJson, stamp, now, ct)
            : EditMoney.Staged.None;

        log.NoteContentChanged();
        await LogContentStaging.StageAsync(
            repository,
            complianceService,
            log,
            idGenerator.New(),
            documentJson,
            DailyLogContent.OriginRevision,
            command.BaseVersion,
            now,
            stamp,
            // Lines only for items no line stands for yet (see TaskLines).
            TaskLines.NewSince(current?.DocumentJson),
            ct);

        // ── lane L6 — a material change re-opens a confirmed day (shared with move_daily_log) ─
        var (priorStatus, reOpen, reAttested, reAttestedRole) =
            MaterialChangeReopen.Apply(log, command.ActorUserId, actorRole, isCreator, now, idGenerator);

        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "DailyLog",
                entityId: log.Id,
                action: "ContentRevised",
                actorUserId: command.ActorUserId,
                actorRole: command.ActorRole ?? "unknown",
                payload: new
                {
                    logId = log.Id,
                    fromVersion,
                    toVersion = log.ContentVersion,
                    baseVersion = command.BaseVersion,
                    staleBase,
                    wordsCarriedForward = wordsCarried,
                    pricesCarriedForward = priceCheck.PricesCarried,
                    reason = command.Reason,
                },
                farmId: farmId,
                clientCommandId: command.ClientRequestId,
                appVersion: appVersion,
                deviceId: command.AuditDeviceId,
                ipHash: command.AuditIpHash,
                sourceAiJobId: null),
            ct);

        if (reOpen is not null)
        {
            await repository.AddAuditEventAsync(
                AuditEventFactory.Create(
                    entityType: "DailyLog",
                    entityId: log.Id,
                    action: "VerificationChanged",
                    actorUserId: command.ActorUserId,
                    actorRole: command.ActorRole ?? "unknown",
                    payload: new
                    {
                        logId = log.Id,
                        from = priorStatus.ToString(),
                        to = log.CurrentVerificationStatus.ToString(),
                        trigger = "ContentRevised",
                        toVersion = log.ContentVersion,
                        reAttestedByCreator = reAttested,
                        role = reAttestedRole,
                        autoSavedFromVoice = log.WasAutoSavedFromVoice,
                    },
                    farmId: farmId,
                    clientCommandId: command.ClientRequestId,
                    appVersion: appVersion,
                    deviceId: command.AuditDeviceId,
                    ipHash: command.AuditIpHash,
                    sourceAiJobId: null),
                ct);
        }

        // Review N1 — a lost race for this version discards the attempt; the loop re-applies it.
        if (!await repository.TrySaveContentRevisionAsync(ct))
        {
            return null;
        }

        var answer = await editMoney.FinishAsync(log, money, stamp, now, ct);

        if (staleBase)
        {
            logger.LogInformation(
                "revise_log_content for {LogId} was made from version {BaseVersion} while the record was at {FromVersion}; appended as {ToVersion}, both kept.",
                log.Id, command.BaseVersion, fromVersion, log.ContentVersion);
        }

        if (priorStatus == VerificationStatus.Verified
            && log.CurrentVerificationStatus != VerificationStatus.Verified
            && logVerificationChanged is not null)
        {
            await logVerificationChanged.HandleAsync(
                log.Id, log.CurrentVerificationStatus, new UserId(command.ActorUserId), ct);
        }

        return Result.Success(await ForReaderAsync(answer, log, command.ActorUserId, now, ct));
    }

    /// <summary>
    /// lane MU-3 fix 1 (F5) — the answer as the PULL would send it to the editor: the record through
    /// <see cref="ReadScopeProjection.Record"/>; the money it made or corrected only to an editor who sees money
    /// (the lines whose money did not follow name no amount and stay).
    /// </summary>
    private async Task<ReviseLogContentResultDto> ForReaderAsync(
        ReviseLogContentResultDto answer, DailyLog log, Guid actor, DateTime now, CancellationToken ct)
    {
        var scope = await FarmReadGate.ScopeAsync(repository, (Guid)log.FarmId, actor, now, ct);
        return answer with
        {
            Log = ReadScopeProjection.Record(answer.Log, scope, actor),
            MoneyChanged = ReadScopeProjection.Money(answer.MoneyChanged, scope),
            MoneyCorrections = ReadScopeProjection.Money(answer.MoneyCorrections, scope),
        };
    }
}
