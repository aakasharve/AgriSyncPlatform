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
    : IHandler<ReviseLogContentCommand, DailyLogDto>
{
    /// <summary>How many times a revision that lost the race for its version is re-applied on top.</summary>
    internal const int MaxAttempts = 3;

    public async Task<Result<DailyLogDto>> HandleAsync(ReviseLogContentCommand command, CancellationToken ct = default)
    {
        if (command.DailyLogId == Guid.Empty || command.ActorUserId == Guid.Empty || command.BaseVersion < 1)
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.InvalidCommand);
        }

        // The document is checked BEFORE anything is read for writing, so a refusal stages nothing.
        if (Problem(command.ContentJson) is { } problem)
        {
            logger.LogWarning("revise_log_content for {LogId} refused: {Problem}", command.DailyLogId, problem);
            return Result.Failure<DailyLogDto>(ShramSafalErrors.LogContentInvalid);
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
                return Result.Failure<DailyLogDto>(ShramSafalErrors.LogContentVersionConflict);
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
    private async Task<Result<DailyLogDto>?> ReviseAsync(ReviseLogContentCommand command, CancellationToken ct)
    {
        var log = await repository.GetDailyLogByIdAsync(command.DailyLogId, ct);
        if (log is null)
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.DailyLogNotFound);
        }

        // E4 — the farm is the LOG's farm, read here; nothing in the payload names one.
        var farmId = (Guid)log.FarmId;
        if (!await repository.IsUserMemberOfFarmAsync(farmId, command.ActorUserId, ct))
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.Forbidden);
        }

        var gate = await EntitlementGate.CheckAsync<DailyLogDto>(
            entitlementPolicy, new UserId(command.ActorUserId), new FarmId(farmId),
            PaidFeature.WriteDailyLog, ct);
        if (gate is not null) return gate;

        var now = clock.UtcNow;
        var isCreator = command.ActorUserId == log.OperatorUserId.Value;
        if (!isCreator && !await LabourManagementGate.IsAllowedAsync(
                repository, farmId, command.ActorUserId, now, ct))
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.Forbidden);
        }

        if (log.WasCapturedAtLabourDoor)
        {
            logger.LogWarning(
                "revise_log_content for {LogId} refused: the record was saved at the labour door (B002).", log.Id);
            return Result.Failure<DailyLogDto>(ShramSafalErrors.LabourDoorLogContent);
        }

        // Authority and the words rule read the role from the DATABASE, never from command.ActorRole.
        var actorRole = await repository.GetUserRoleForFarmAsync(farmId, command.ActorUserId, ct);
        var current = await repository.GetCurrentDailyLogContentAsync(log.Id, ct);

        var documentJson = command.ContentJson;
        if (current is not null && !await RecordWordsGate.MayHearAsync(
                command.ActorUserId,
                log.OperatorUserId.Value,
                actorRole,
                () => LabourManagementGate.HasExplicitGrantAsync(repository, farmId, command.ActorUserId, now, ct)))
        {
            documentJson = LogContentDocument.CarryWordsForward(current.DocumentJson, command.ContentJson);
            if (Problem(documentJson) is { } carried)
            {
                // Only the size cap can refuse here: his words plus this edit no longer fit.
                logger.LogWarning("revise_log_content for {LogId} refused after carrying the words forward: {Problem}", log.Id, carried);
                return Result.Failure<DailyLogDto>(ShramSafalErrors.LogContentInvalid);
            }
        }

        if (current is not null)
        {
            using var incoming = JsonDocument.Parse(documentJson);
            if (LogContentDocument.SameDocument(current.DocumentJson, incoming.RootElement))
            {
                // Nothing moved: no row, no version, no re-open — the edit is already what is stored.
                return Result.Success(log.ToDto());
            }
        }

        var fromVersion = log.ContentVersion;
        var staleBase = command.BaseVersion < fromVersion;
        var appVersion = string.IsNullOrWhiteSpace(command.ClientAppVersion)
            ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
            : command.ClientAppVersion;

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
            new ContentAuditStamp(
                command.ActorUserId,
                command.ActorRole,
                command.ClientRequestId,
                appVersion,
                command.AuditDeviceId,
                command.AuditIpHash),
            // Lines only for items no line stands for yet (see TaskLines).
            TaskLines.NewSince(current?.DocumentJson),
            ct);

        // ── lane L6 — a material change re-opens a confirmed day ─────────────────────────────
        var priorStatus = log.CurrentVerificationStatus;
        VerificationEvent? reOpen = null;
        var reAttested = false;
        string? reAttestedRole = null;
        if (priorStatus != VerificationStatus.Draft)
        {
            // Every event written here is strictly LATER than everything on the log (the status
            // fold is OrderBy(OccurredAtUtc).Last()), the same 1 ms rule as AddLogTaskHandler.
            var lastEventAtUtc = log.VerificationEvents.Count == 0
                ? DateTime.MinValue
                : log.VerificationEvents.Max(e => e.OccurredAtUtc);
            var reOpenAtUtc = now > lastEventAtUtc ? now : lastEventAtUtc.AddMilliseconds(1);

            reOpen = log.Edit(idGenerator.New(), new UserId(command.ActorUserId), reOpenAtUtc);

            if (reOpen is not null && isCreator
                && actorRole is { } role
                && log.TrySelfVerifyAsCreator(
                    idGenerator.New(), idGenerator.New(), role, reOpenAtUtc.AddMilliseconds(1)))
            {
                reAttested = true;
                reAttestedRole = role.ToString();
            }
        }

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
                    wordsCarriedForward = !ReferenceEquals(documentJson, command.ContentJson),
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

        return Result.Success(log.ToDto());
    }
}
