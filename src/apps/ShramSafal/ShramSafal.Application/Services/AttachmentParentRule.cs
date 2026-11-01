using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.Services;

/// <summary>
/// lane MU-3 (plan step 4a) — an attachment is read where its PARENT is read (<see cref="FarmReadScope"/>):
/// <list type="bullet">
/// <item><c>Farm</c> — every working seat of the farm;</item>
/// <item><c>DailyLog</c> — where the record is read: the farm's records, or for an own-records-only seat
/// only the records he made (the parent must be on the attachment's own farm, E4);</item>
/// <item><c>CostEntry</c> — a money receipt: only a seat that sees money;</item>
/// <item>anything else — the primary account holder only (a kind this rule does not know fails closed).</item>
/// </list>
/// The sync pull and the attachment reads (<c>/attachments</c>) share this one rule.
/// </summary>
public static class AttachmentParentRule
{
    public const string FarmParent = "Farm";
    public const string RecordParent = "DailyLog";
    public const string MoneyParent = "CostEntry";

    /// <summary>Is the parent a record (whose readability may depend on who made it)?</summary>
    public static bool IsRecordParent(string? linkedEntityType) =>
        string.Equals(linkedEntityType, RecordParent, StringComparison.Ordinal);

    /// <summary>
    /// May the holder of <paramref name="scope"/> read <paramref name="attachment"/>?
    /// <paramref name="parentLog"/> is needed only for a record's attachment on an own-records-only seat;
    /// when it is needed and absent (or on another farm) the answer is no.
    /// </summary>
    public static bool MayRead(FarmReadScope? scope, Guid readerUserId, Attachment attachment, DailyLog? parentLog)
    {
        ArgumentNullException.ThrowIfNull(attachment);
        if (scope is null || scope.FarmId != (Guid)attachment.FarmId)
        {
            return false;
        }

        return attachment.LinkedEntityType switch
        {
            FarmParent => true,
            RecordParent => !scope.OwnRecordsOnly
                || (parentLog is not null
                    && parentLog.Id == attachment.LinkedEntityId
                    && parentLog.FarmId == attachment.FarmId
                    && scope.MayReadRecordOf(readerUserId, parentLog.OperatorUserId.Value)),
            MoneyParent => scope.SeeMoney,
            _ => scope.IsPrimaryAccountHolder,
        };
    }

    /// <summary>
    /// The same rule for one attachment read on its own (<c>/attachments/{id}</c>, its download, the
    /// per-record list): loads the caller's scope on the attachment's farm and, only when the rule needs
    /// it, the parent record.
    /// </summary>
    public static async Task<bool> MayReadAsync(
        Ports.IShramSafalRepository repository,
        Attachment attachment,
        Guid readerUserId,
        DateTime atUtc,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(attachment);

        var scope = await FarmReadGate.ScopeAsync(repository, (Guid)attachment.FarmId, readerUserId, atUtc, ct);
        if (scope is null)
        {
            return false;
        }

        var parentLog = IsRecordParent(attachment.LinkedEntityType) && scope.OwnRecordsOnly
            ? await repository.GetDailyLogByIdAsync(attachment.LinkedEntityId, ct)
            : null;
        return MayRead(scope, readerUserId, attachment, parentLog);
    }
}
