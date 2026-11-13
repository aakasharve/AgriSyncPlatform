// spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-D3; founder D-68 round 2)
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.UseCases.Compare.SetLogPracticeReason;

/// <summary>
/// What the sender is told: the row he made (or the row a repeat of his request already made). Ids, the kind and the flag - NEVER his words (P001): the push
/// door stores this answer in <c>ssf.sync_mutations</c> and replays it, and erasure scrubs only the reason row, so his words must not be in it.
/// </summary>
public sealed record LogPracticeReasonDto(
    Guid ReasonId,
    Guid DailyLogId,
    string WorkKey,
    string Kind,
    bool SaidByVoice,
    Guid? SupersedesId,
    DateTime CreatedAtUtc)
{
    public static LogPracticeReasonDto From(LogPracticeReason r) =>
        new(r.Id, r.DailyLogId, r.WorkKey, LogReasonKindWire.ToWire(r.Kind), r.SaidByVoice, r.SupersedesId, r.CreatedAtUtc);
}

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 - lane CMP-D3 (founder D-68 round 2; P1, P3, P4, E4) - the ONE handler behind
/// <c>logreason.set</c>: a reason kept on ONE item of ONE saved record ("का केलं").
///
/// <list type="number">
/// <item><b>Authority FIRST, then the record (E4: no oracle).</b> Who may: whoever may open तुलना (<see cref="FarmCompareGate.Gate"/>: the primary
/// account holder, or a seat that holds <see cref="FarmAuthority.SeeCompare"/> now) on the farm the payload names. A seat without it, a worker, a
/// paused / waiting / removed seat and a stranger to the farm all get the SAME refusal (<see cref="ShramSafalErrors.Forbidden"/>) for a real record, a
/// made-up one and another farm's, because the record is not read until the authority is shown.</item>
/// <item><b>Then the record, and may he see it.</b> The record is looked up under the farm's own scope: another farm's record and a made-up id are
/// both <see cref="ShramSafalErrors.DailyLogNotFound"/>. A record kept from him (its audience, his plots, an own-records-only seat) answers
/// the SAME way - a reader never learns that a hidden record exists. The rule is the one the compare read lists with
/// (<see cref="RecordAudienceGate.MaySeeLogAsync"/> and <see cref="FarmReadScope.MayReadRecordOf"/>); no second rule.</item>
/// <item><b>Which item.</b> The key must be the key of a RECOGNISED task of that record (<see cref="CompareWorkKey"/>, the one तुलना shows); an
/// unrecognised item never carries a reason (R12), and a key the record does not have is refused with nothing written.</item>
/// <item><b>An overlay, never an edit.</b> The record is read and never written: its content, version, tasks, confirmation and verification are not
/// touched. The row carries no quantity and nothing is read from its words (P4). Audit: ids, the kind and the flag - never his words.</item>
/// <item><b>A repeat is the same row; a later reason supersedes.</b> The same reason id answers the stored row and writes nothing. A new id for the same
/// record + item is a NEW row naming the one it replaces (<c>supersedes_id</c>); both stay (P3).</item>
/// </list>
/// </summary>
public sealed class SetLogPracticeReasonHandler(
    IShramSafalRepository repository,
    ILogPracticeReasonStore store,
    IClock clock)
{
    public const string AppliedAction = "LogPracticeReasonSet";

    /// <summary>The code the phone and the sync layer know for "this change, as sent, can never be applied".</summary>
    public const string InvalidPayloadCode = "ShramSafal.SyncInvalidPayload";

    /// <summary>The words of the refusal for a reason id already used for another reason (on this farm or, invisibly, on another).</summary>
    public const string ReasonIdUsedDescription = "This reason id was already used for another reason.";

    private static Error Invalid(string description) => Error.Validation(InvalidPayloadCode, description);

    public async Task<Result<LogPracticeReasonDto>> HandleAsync(SetLogPracticeReasonCommand command, CancellationToken ct = default)
    {
        if (command is null
            || command.ReasonId == Guid.Empty
            || command.FarmId == Guid.Empty
            || command.DailyLogId == Guid.Empty
            || command.AuthorUserId == Guid.Empty
            || string.IsNullOrWhiteSpace(command.ClientMutationId))
        {
            return Result.Failure<LogPracticeReasonDto>(ShramSafalErrors.InvalidCommand);
        }

        // 1. AUTHORITY, before anything of the record is read (E4). The farm is the one the payload names; under its scope another farm's
        // standing reads as none.
        var now = clock.UtcNow;
        var caller = command.AuthorUserId;
        var access = await repository.GetFarmAccessForUserAsync(command.FarmId, caller, ct);
        var scope = FarmReadScope.Of(command.FarmId, access, now);
        if (scope is null || !FarmCompareGate.Gate(access, now))
        {
            return Result.Failure<LogPracticeReasonDto>(ShramSafalErrors.Forbidden);
        }

        // 2. The change itself must be well formed (a kind outside the three, words over the limit, a key that is not a key).
        if (!LogReasonKindWire.TryParse(command.Kind, out var kind))
        {
            return Result.Failure<LogPracticeReasonDto>(Invalid("The reason must be Practice, Extra or Weather."));
        }

        var key = command.WorkKey?.Trim();
        if (string.IsNullOrEmpty(key) || key.Length > LogPracticeReason.MaxWorkKeyLength)
        {
            return Result.Failure<LogPracticeReasonDto>(Invalid("The reason names the work it is about."));
        }

        var words = string.IsNullOrWhiteSpace(command.Words) ? null : command.Words.Trim();
        if (words is not null && words.Length > LogPracticeReason.MaxWordsLength)
        {
            return Result.Failure<LogPracticeReasonDto>(Invalid($"The words are at most {LogPracticeReason.MaxWordsLength} characters."));
        }

        // 3. The record, on THIS farm only; one answer for a record that is not there, is another farm's, or is kept from him.
        var log = await repository.GetDailyLogByIdAsync(command.DailyLogId, ct);
        if (log is null
            || (Guid)log.FarmId != command.FarmId
            || !scope.MayReadRecordOf(caller, log.OperatorUserId.Value)
            || !await RecordAudienceGate.MaySeeLogAsync(repository, log, caller, now, ct))
        {
            return Result.Failure<LogPracticeReasonDto>(ShramSafalErrors.DailyLogNotFound);
        }

        // 4. A repeat of the same reason is the row it already made, whatever has happened since.
        var repeated = await store.GetByIdAsync(command.ReasonId, ct);
        if (repeated is not null)
        {
            return repeated.FarmId == log.FarmId && repeated.DailyLogId == log.Id && repeated.AuthorUserId.Value == caller
                ? Result.Success(LogPracticeReasonDto.From(repeated))
                : Result.Failure<LogPracticeReasonDto>(Invalid(ReasonIdUsedDescription));
        }

        // 5. Which item: a RECOGNISED task of this record, by the key तुलना shows (R12: never a not-recognised one).
        var items = log.Tasks
            .Select(t => CompareWorkKey.OfWords(t.ActivityType))
            .Where(k => k != CompareWorkKey.Unrecognised)
            .ToHashSet(StringComparer.Ordinal);
        if (!items.Contains(key))
        {
            return Result.Failure<LogPracticeReasonDto>(Invalid("The record has no such work."));
        }

        // 6. The new row supersedes the latest one of the same record + item (history stays, P3).
        var latest = await store.GetLatestAsync(log.Id, key, ct);
        LogPracticeReason reason;
        try
        {
            reason = LogPracticeReason.Create(
                command.ReasonId, log.FarmId, log.Id, key, kind, words, command.SaidByVoice, new UserId(caller), now, latest?.Id);
        }
        catch (ArgumentException)
        {
            // A field the entity's own rules refuse. The bytes are the bytes: never retried.
            return Result.Failure<LogPracticeReasonDto>(Invalid("The reason is not well formed."));
        }

        var appVersion = string.IsNullOrWhiteSpace(command.ClientAppVersion)
            ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
            : command.ClientAppVersion;

        // Stage only: the single SaveChangesAsync below commits the reason and its audit row together. The record is not touched.
        store.Stage(reason);
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "LogPracticeReason",
                entityId: reason.Id,
                action: AppliedAction,
                actorUserId: caller,
                actorRole: access!.Role.ToString(),
                // Ids, the kind and the flag: never his words.
                payload: new
                {
                    reasonId = reason.Id,
                    dailyLogId = reason.DailyLogId,
                    workKey = reason.WorkKey,
                    kind = LogReasonKindWire.ToWire(reason.Kind),
                    saidByVoice = reason.SaidByVoice,
                    supersedesId = reason.SupersedesId,
                },
                farmId: (Guid)log.FarmId,
                clientCommandId: command.ClientMutationId,
                appVersion: appVersion,
                deviceId: command.AuditDeviceId,
                ipHash: command.AuditIpHash,
                sourceAiJobId: null),
            ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success(LogPracticeReasonDto.From(reason));
    }
}
