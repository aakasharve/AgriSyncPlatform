using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Logs;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (lane F1) — WHAT SATHI UNDERSTOOD for one
/// <see cref="DailyLog"/>, at one record version: the phone's own buckets (crop work, water,
/// inputs, notes, machinery, expenses, planned work), the disturbance chip and his whole words,
/// each item with its values, units, his phrase and the verified flag — stored as the phone sent
/// them, so no phone ever rebuilds his record by guessing it back from flattened task lines.
///
/// <para><b>One unchangeable row per version (doctrine P3).</b> Current truth is the row with the
/// highest <see cref="ContentVersion"/> for a log; every earlier row is history. Nothing here has a
/// setter a handler can reach, and the database revokes UPDATE / DELETE / TRUNCATE from the app
/// role (migration <c>AddDailyLogContents</c>). The one change ever made to a stored row is
/// <see cref="EraseWords"/>, run by account erasure through the privileged admin context.</para>
///
/// <para><b>Which version did he confirm?</b> <see cref="ContentVersion"/> is the log's
/// <see cref="DailyLog.ContentVersion"/> at the moment the row was written. Labour corrections and
/// old-phone task lines move the log's version without writing a row, so the content an owner
/// confirmed at version V is the latest row whose <see cref="ContentVersion"/> is &lt;= V.</para>
///
/// <para><b>Phase 1 (doctrine P1).</b> A row is staged with its log, before the log's main save —
/// never in the best-effort side-car. It is what the farmer said, not something the system
/// inferred.</para>
/// </summary>
public sealed class DailyLogContent : Entity<Guid>
{
    /// <summary>Written by the create of a phone that sent its own content.</summary>
    public const string OriginCreate = "create";

    /// <summary>
    /// Written by the create of an OLDER phone (1.0.15–1.0.17) that sent a manual draft: the
    /// draft's buckets are the very arrays that phone saved, so they are stored as its content.
    /// </summary>
    public const string OriginManualDraft = "manual_draft";

    /// <summary>Written by <c>revise_log_content</c>: an edit, appended as a new version.</summary>
    public const string OriginRevision = "revision";

    private static readonly HashSet<string> Origins = new(StringComparer.Ordinal)
    {
        OriginCreate,
        OriginManualDraft,
        OriginRevision,
    };

    private DailyLogContent() : base(Guid.Empty) { } // EF Core

    private DailyLogContent(
        Guid id,
        Guid dailyLogId,
        FarmId farmId,
        int contentVersion,
        int schemaVersion,
        string documentJson,
        string origin,
        int? baseVersion,
        UserId writtenByUserId,
        DateTime writtenAtUtc,
        string? clientRequestId,
        string? appVersion)
        : base(id)
    {
        DailyLogId = dailyLogId;
        FarmId = farmId;
        ContentVersion = contentVersion;
        SchemaVersion = schemaVersion;
        DocumentJson = documentJson;
        Origin = origin;
        BaseVersion = baseVersion;
        WrittenByUserId = writtenByUserId;
        WrittenAtUtc = writtenAtUtc;
        ClientRequestId = clientRequestId;
        AppVersion = appVersion;
    }

    public Guid DailyLogId { get; private set; }

    /// <summary>The tenant column (doctrine F8). Always the LOG's farm, never a caller's claim.</summary>
    public FarmId FarmId { get; private set; }

    /// <summary>The log's <see cref="DailyLog.ContentVersion"/> when this row was written.</summary>
    public int ContentVersion { get; private set; }

    /// <summary>The document format (<c>schema</c> inside the document).</summary>
    public int SchemaVersion { get; private set; }

    /// <summary>The document, as JSON text (a <c>jsonb</c> column).</summary>
    public string DocumentJson { get; private set; } = "{}";

    public string Origin { get; private set; } = OriginCreate;

    /// <summary>For a revision: the version the editor saw. Null for a create.</summary>
    public int? BaseVersion { get; private set; }

    public UserId WrittenByUserId { get; private set; }

    public DateTime WrittenAtUtc { get; private set; }

    public string? ClientRequestId { get; private set; }

    public string? AppVersion { get; private set; }

    /// <summary>When account erasure removed his words from this row; null until then.</summary>
    public DateTime? WordsErasedAtUtc { get; private set; }

    /// <summary>
    /// Stages the content of <paramref name="log"/> at its CURRENT version. The farm and the
    /// version are read off the log itself, so a caller cannot file content under another farm
    /// or another version.
    /// </summary>
    public static DailyLogContent Create(
        Guid id,
        DailyLog log,
        int schemaVersion,
        string documentJson,
        string origin,
        int? baseVersion,
        UserId writtenByUserId,
        DateTime writtenAtUtc,
        string? clientRequestId,
        string? appVersion)
    {
        ArgumentNullException.ThrowIfNull(log);

        if (id == Guid.Empty)
        {
            throw new ArgumentException("Content id is required.", nameof(id));
        }

        if (schemaVersion < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(schemaVersion), schemaVersion, "The document format starts at 1.");
        }

        if (string.IsNullOrWhiteSpace(documentJson))
        {
            throw new ArgumentException("The content document is required.", nameof(documentJson));
        }

        if (!Origins.Contains(origin))
        {
            throw new ArgumentException($"Unknown content origin '{origin}'.", nameof(origin));
        }

        if (origin == OriginRevision)
        {
            if (baseVersion is not { } seen || seen < 1)
            {
                throw new ArgumentException("A revision states the version it was made from.", nameof(baseVersion));
            }
        }
        else if (baseVersion is not null)
        {
            throw new ArgumentException("Only a revision carries a base version.", nameof(baseVersion));
        }

        if (log.ContentVersion < 1)
        {
            throw new InvalidOperationException("A record version starts at 1.");
        }

        return new DailyLogContent(
            id,
            log.Id,
            log.FarmId,
            log.ContentVersion,
            schemaVersion,
            documentJson,
            origin,
            baseVersion,
            writtenByUserId,
            writtenAtUtc,
            string.IsNullOrWhiteSpace(clientRequestId) ? null : clientRequestId.Trim(),
            string.IsNullOrWhiteSpace(appVersion) ? null : appVersion.Trim());
    }

    /// <summary>
    /// Account erasure (doctrine P6): the document with his words removed. The values — what was
    /// done, how much, when — stay; only his words go. Set once.
    /// </summary>
    public void EraseWords(string documentWithoutWords, DateTime erasedAtUtc)
    {
        if (string.IsNullOrWhiteSpace(documentWithoutWords))
        {
            throw new ArgumentException("The erased document is required.", nameof(documentWithoutWords));
        }

        DocumentJson = documentWithoutWords;
        WordsErasedAtUtc ??= erasedAtUtc;
    }
}
