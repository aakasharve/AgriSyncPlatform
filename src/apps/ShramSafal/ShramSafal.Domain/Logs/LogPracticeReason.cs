using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Logs;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 - lane CMP-D3 (founder D-68 round 2): the three pictures behind "का केलं". Nothing else
/// is ever stored as a kind.
/// </summary>
public enum LogReasonKind
{
    /// <summary>My way of working.</summary>
    Practice = 1,

    /// <summary>Extra work was needed.</summary>
    Extra = 2,

    /// <summary>The weather made the change.</summary>
    Weather = 3,
}

/// <summary>The wire words of <see cref="LogReasonKind"/> (exactly these, exactly this spelling) and the stored column's words.</summary>
public static class LogReasonKindWire
{
    public const string Practice = "Practice";
    public const string Extra = "Extra";
    public const string Weather = "Weather";

    public static bool TryParse(string? wire, out LogReasonKind kind)
    {
        switch (wire)
        {
            case Practice: kind = LogReasonKind.Practice; return true;
            case Extra: kind = LogReasonKind.Extra; return true;
            case Weather: kind = LogReasonKind.Weather; return true;
            default: kind = default; return false;
        }
    }

    public static string ToWire(LogReasonKind kind) => kind switch
    {
        LogReasonKind.Practice => Practice,
        LogReasonKind.Extra => Extra,
        LogReasonKind.Weather => Weather,
        _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "Unknown reason kind."),
    };
}

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 - lane CMP-D3 (founder D-68 round 2; P1, P3, P4): a REASON kept on an existing record
/// of work - why one item of a saved record was done the way it was. <c>ssf.log_practice_reasons</c>.
///
/// <para><b>An overlay, never an edit and never new work.</b> The row is its own and nothing else: the record's content document, its version,
/// its tasks, its confirmation and its verification are not touched. It carries no quantity and nothing is ever read from its words for a
/// number (P4).</para>
///
/// <para><b>Append-only (P3).</b> A reason is never edited and never removed (the app role holds SELECT and INSERT only). A later reason for
/// the same record + item is a NEW row whose <see cref="SupersedesId"/> names the one it replaces; both stay and the latest row per
/// (<see cref="DailyLogId"/>, <see cref="WorkKey"/>) is the reason that is shown.</para>
/// </summary>
public sealed class LogPracticeReason : Entity<Guid>
{
    /// <summary>The most characters of his words (the column is <c>varchar(1000)</c>).</summary>
    public const int MaxWordsLength = 1000;

    /// <summary>The most characters of a work key (the column is <c>varchar(100)</c>).</summary>
    public const int MaxWorkKeyLength = 100;

    private LogPracticeReason() : base(Guid.Empty) { } // EF Core

    private LogPracticeReason(
        Guid id,
        FarmId farmId,
        Guid dailyLogId,
        string workKey,
        LogReasonKind kind,
        string? words,
        bool saidByVoice,
        UserId authorUserId,
        DateTime createdAtUtc,
        Guid? supersedesId)
        : base(id)
    {
        FarmId = farmId;
        DailyLogId = dailyLogId;
        WorkKey = workKey;
        Kind = kind;
        Words = words;
        SaidByVoice = saidByVoice;
        AuthorUserId = authorUserId;
        CreatedAtUtc = createdAtUtc;
        SupersedesId = supersedesId;
    }

    public FarmId FarmId { get; private set; }
    public Guid DailyLogId { get; private set; }

    /// <summary>Which item of the record: <see cref="ShramSafal.Domain.Compare.CompareWorkKey"/>.</summary>
    public string WorkKey { get; private set; } = string.Empty;

    public LogReasonKind Kind { get; private set; }

    /// <summary>What he said, or null (he only picked the picture, or erasure removed his words; the kind stays).</summary>
    public string? Words { get; private set; }

    /// <summary>True only when there are words and they came from the mic.</summary>
    public bool SaidByVoice { get; private set; }

    public UserId AuthorUserId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }

    /// <summary>The reason this one replaces (the latest one of the same record + item when it was made), or null for the first.</summary>
    public Guid? SupersedesId { get; private set; }

    /// <summary>
    /// Makes one reason. Throws <see cref="ArgumentException"/> for a value the rules refuse (an empty id, an empty or over-long key, a kind that is
    /// not one of the three, words over <see cref="MaxWordsLength"/>). Words are trimmed; blank words are none. A reason "said by voice" without
    /// words is not said by voice (nothing was said): the flag follows the words.
    /// </summary>
    public static LogPracticeReason Create(
        Guid id,
        FarmId farmId,
        Guid dailyLogId,
        string workKey,
        LogReasonKind kind,
        string? words,
        bool saidByVoice,
        UserId authorUserId,
        DateTime createdAtUtc,
        Guid? supersedesId)
    {
        if (id == Guid.Empty)
        {
            throw new ArgumentException("Reason id is required.", nameof(id));
        }

        if (farmId.IsEmpty)
        {
            throw new ArgumentException("FarmId is required.", nameof(farmId));
        }

        if (dailyLogId == Guid.Empty)
        {
            throw new ArgumentException("The record is required.", nameof(dailyLogId));
        }

        if (authorUserId.IsEmpty)
        {
            throw new ArgumentException("The author is required.", nameof(authorUserId));
        }

        var key = workKey?.Trim();
        if (string.IsNullOrEmpty(key) || key.Length > MaxWorkKeyLength)
        {
            throw new ArgumentException($"The work key is required, at most {MaxWorkKeyLength} characters.", nameof(workKey));
        }

        if (!Enum.IsDefined(kind))
        {
            throw new ArgumentException("The kind must be Practice, Extra or Weather.", nameof(kind));
        }

        var text = string.IsNullOrWhiteSpace(words) ? null : words.Trim();
        if (text is not null && text.Length > MaxWordsLength)
        {
            throw new ArgumentException($"The words are at most {MaxWordsLength} characters.", nameof(words));
        }

        if (supersedesId == id)
        {
            throw new ArgumentException("A reason cannot supersede itself.", nameof(supersedesId));
        }

        return new LogPracticeReason(
            id, farmId, dailyLogId, key, kind, text, saidByVoice && text is not null, authorUserId,
            DateTime.SpecifyKind(createdAtUtc, DateTimeKind.Utc), supersedesId);
    }
}
