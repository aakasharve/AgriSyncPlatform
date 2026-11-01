using ShramSafal.Domain.Attachments;

namespace ShramSafal.Application.Services;

/// <summary>lane MU-3 fix 1 (F12) — who made one record, and on which farm (the photo rule needs nothing more).</summary>
public sealed record RecordMaker(Guid DailyLogId, Guid FarmId, Guid OperatorUserId);

/// <summary>
/// lane MU-3 (plan step 4a) — an attachment is read where its PARENT is read (<see cref="FarmReadScope"/>):
/// <list type="bullet">
/// <item><c>Bill</c> — a bill or receipt photo (MU-3 fix 1, F2; the phone's two bill flows send this marker):
/// money, so only a seat that sees money;</item>
/// <item><c>Farm</c> — linked to the farm itself. Every farm-linked photo this app has ever made is a BILL
/// (the phone's bill flows — <c>ReceiptCaptureSheet</c>, <c>unsentMoney</c> — linked their photo to the farm
/// before the <c>Bill</c> marker existed, and 1.0.15–1.0.17 still do; no other flow links to the farm), so it
/// is money too: fail closed, never guessed from a file name;</item>
/// <item><c>CostEntry</c> — a money receipt: only a seat that sees money;</item>
/// <item><c>DailyLog</c> — where the record is read: the farm's records, or for an own-records-only seat
/// only the records he made (the parent must be on the attachment's own farm, E4);</item>
/// <item>anything else — the primary account holder only (a kind this rule does not know fails closed).</item>
/// </list>
/// The sync pull and the attachment reads (<c>/attachments</c>) share this one rule.
/// </summary>
public static class AttachmentParentRule
{
    public const string FarmParent = "Farm";
    public const string BillParent = "Bill";
    public const string RecordParent = "DailyLog";
    public const string MoneyParent = "CostEntry";

    /// <summary>Is the parent a record (whose readability may depend on who made it)?</summary>
    public static bool IsRecordParent(string? linkedEntityType) =>
        string.Equals(linkedEntityType, RecordParent, StringComparison.Ordinal);

    /// <summary>Is the attachment a bill, a receipt or any money photo (the farm-linked legacy bills included)?</summary>
    public static bool IsMoneyPhoto(string? linkedEntityType) =>
        linkedEntityType is BillParent or FarmParent or MoneyParent;

    /// <summary>
    /// May the holder of <paramref name="scope"/> read <paramref name="attachment"/>?
    /// <paramref name="parentMaker"/> is needed only for a record's attachment on an own-records-only seat;
    /// when it is needed and absent (or on another farm) the answer is no.
    /// </summary>
    public static bool MayRead(FarmReadScope? scope, Guid readerUserId, Attachment attachment, RecordMaker? parentMaker)
    {
        ArgumentNullException.ThrowIfNull(attachment);
        if (scope is null || scope.FarmId != (Guid)attachment.FarmId)
        {
            return false;
        }

        if (IsMoneyPhoto(attachment.LinkedEntityType))
        {
            return scope.SeeMoney;
        }

        return attachment.LinkedEntityType switch
        {
            RecordParent => !scope.OwnRecordsOnly
                || (parentMaker is not null
                    && parentMaker.DailyLogId == attachment.LinkedEntityId
                    && parentMaker.FarmId == (Guid)attachment.FarmId
                    && scope.MayReadRecordOf(readerUserId, parentMaker.OperatorUserId)),
            _ => scope.IsPrimaryAccountHolder,
        };
    }

    /// <summary>
    /// The same rule for any number of attachments read together (<c>/attachments</c>, its metadata and
    /// download): the reader's standing is read ONCE for all their farms and the parent records ONCE, only
    /// where an own-records-only seat needs them (F12: never one read per attachment).
    /// </summary>
    public static async Task<IReadOnlyList<Attachment>> ReadableAsync(
        Ports.IShramSafalRepository repository,
        IReadOnlyCollection<Attachment> attachments,
        Guid readerUserId,
        DateTime atUtc,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(attachments);
        if (attachments.Count == 0 || readerUserId == Guid.Empty)
        {
            return [];
        }

        var accesses = await repository.GetFarmAccessesForUserAsync(
            readerUserId, attachments.Select(a => (Guid)a.FarmId).Distinct().ToList(), ct);
        var scopes = accesses.ToDictionary(kv => kv.Key, kv => FarmReadScope.Of(kv.Key, kv.Value, atUtc));
        var needMakers = attachments
            .Where(a => IsRecordParent(a.LinkedEntityType)
                && scopes.GetValueOrDefault((Guid)a.FarmId) is { OwnRecordsOnly: true })
            .Select(a => a.LinkedEntityId)
            .ToList();
        IReadOnlyDictionary<Guid, RecordMaker> makers = needMakers.Count == 0
            ? new Dictionary<Guid, RecordMaker>()
            : await repository.GetRecordMakersAsync(needMakers, ct);

        // spec: plr-d10 lane PRV (founder D-26) — and where its parent's AUDIENCE includes him: a photo of a record kept
        // from him, or a bill photo a money record kept from him names, is not his (one read for all their farms).
        var visibility = RecordVisibility.For(
            readerUserId,
            scopes.Where(kv => kv.Value is not null).ToDictionary(kv => kv.Key, kv => kv.Value!),
            await repository.GetRestrictedRecordsAsync(scopes.Keys.ToList(), ct));
        return attachments
            .Where(a => MayRead(scopes.GetValueOrDefault((Guid)a.FarmId), readerUserId, a, makers.GetValueOrDefault(a.LinkedEntityId)))
            .Where(visibility.MaySeeAttachment)
            .ToList();
    }

    /// <summary>One attachment read on its own (<c>/attachments/{id}</c>, its download).</summary>
    public static async Task<bool> MayReadAsync(
        Ports.IShramSafalRepository repository,
        Attachment attachment,
        Guid readerUserId,
        DateTime atUtc,
        CancellationToken ct = default) =>
        (await ReadableAsync(repository, [attachment], readerUserId, atUtc, ct)).Count == 1;
}
