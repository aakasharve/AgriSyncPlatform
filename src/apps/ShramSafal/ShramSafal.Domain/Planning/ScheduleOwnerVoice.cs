using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Finance;

namespace ShramSafal.Domain.Planning;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b, "The schedule owner's voice"; approved spec plr-d10-schedule-approved-spec-2026-11-23, "Owner's voice")
//
// The owner of a reference schedule sends a REAL recorded message about one of its works; a follower hears it and decides. A message changes NOTHING by itself (P-rule: nothing is
// invented, a message is a voice, not an edit): sending or hearing one writes no own work, revision, plan or log. Only the farmer's decision does, and only through the own-schedule
// gate AND the planning permission.

/// <summary>The three kinds of message, and no other: a tip (about one work), a change of plan (before and now), look and tell (a question with exactly two answers).</summary>
public enum ScheduleOwnerMessageKind : short
{
    Tip = 0,
    Change = 1,
    Look = 2,
}

/// <summary>The wire words of a message kind (<c>tip</c>, <c>change</c>, <c>look</c>).</summary>
public static class ScheduleOwnerMessageKindWire
{
    public static string ToWire(ScheduleOwnerMessageKind kind) => kind switch
    {
        ScheduleOwnerMessageKind.Tip => "tip",
        ScheduleOwnerMessageKind.Change => "change",
        _ => "look",
    };

    public static bool TryParse(string? wire, out ScheduleOwnerMessageKind kind)
    {
        switch (wire?.Trim().ToLowerInvariant())
        {
            case "tip":
                kind = ScheduleOwnerMessageKind.Tip;
                return true;
            case "change":
                kind = ScheduleOwnerMessageKind.Change;
                return true;
            case "look":
                kind = ScheduleOwnerMessageKind.Look;
                return true;
            default:
                kind = default;
                return false;
        }
    }
}

/// <summary>A message that does not hold together. The code is stable; the words say the rule.</summary>
public sealed record ScheduleOwnerProblem(string Code, string Message);

/// <summary>
/// The metadata of one real recording of a schedule owner (<c>ssf.schedule_owner_clips</c>): its OWN store (never the farmer's retained voice, <c>VoiceClipRetained</c>), written once
/// and never changed. The bytes live under the storage prefix <see cref="StoragePrefix"/>; this row holds who sent it, the schedule (version and chain) it is about, the SHA-256 of the
/// bytes, the mime type, the size and the length measured from the file itself.
/// </summary>
public sealed class ScheduleOwnerClip : Entity<Guid>
{
    /// <summary>The storage prefix of every owner clip (through <c>IAttachmentStorageService</c>). Distinct from every other prefix.</summary>
    public const string StoragePrefix = "schedule-owner-clips";

    public const int MaxBytes = 5 * 1024 * 1024;
    public const int MaxDurationMs = 90_000;

    private ScheduleOwnerClip() : base(Guid.Empty) { } // EF Core

    private ScheduleOwnerClip(
        Guid id, Guid chainId, Guid scheduleVersionId, UserId sentBy, string contentHash, string mimeType, long sizeBytes, int durationMs, DateTime atUtc)
        : base(id)
    {
        ChainId = chainId;
        ScheduleVersionId = scheduleVersionId;
        SentByUserId = sentBy;
        ContentHash = contentHash;
        MimeType = mimeType;
        SizeBytes = sizeBytes;
        DurationMs = durationMs;
        StorageKey = StorageKeyFor(id);
        CreatedAtUtc = atUtc;
    }

    /// <summary>The schedule chain (every version of a reference schedule shares one). Followers are matched to a message by it.</summary>
    public Guid ChainId { get; private set; }

    /// <summary>The version the message was sent about.</summary>
    public Guid ScheduleVersionId { get; private set; }

    /// <summary>The person who sent it (ShramSafal staff until a creator can; slice 15 reuses the handler).</summary>
    public UserId SentByUserId { get; private set; }

    /// <summary>SHA-256 of the bytes, lower-case hex.</summary>
    public string ContentHash { get; private set; } = string.Empty;

    public string MimeType { get; private set; } = string.Empty;
    public long SizeBytes { get; private set; }
    public int DurationMs { get; private set; }
    public string StorageKey { get; private set; } = string.Empty;
    public DateTime CreatedAtUtc { get; private set; }

    public static string StorageKeyFor(Guid clipId) => $"{StoragePrefix}/{clipId:N}";

    public static ScheduleOwnerClip? Create(
        Guid id, Guid chainId, Guid scheduleVersionId, UserId sentBy, string contentHash, string mimeType, long sizeBytes, int durationMs, DateTime atUtc, out ScheduleOwnerProblem? problem)
    {
        problem = null;
        if (id == Guid.Empty || chainId == Guid.Empty || scheduleVersionId == Guid.Empty || sentBy.IsEmpty)
        {
            problem = new("OwnerClipPlace", "A clip names its schedule and who sent it.");
            return null;
        }

        if (string.IsNullOrWhiteSpace(contentHash) || contentHash.Length != 64 || string.IsNullOrWhiteSpace(mimeType) || mimeType.Length > 60)
        {
            problem = new("OwnerClipFile", "A clip names the hash and the type of its file.");
            return null;
        }

        if (sizeBytes <= 0 || sizeBytes > MaxBytes)
        {
            problem = new("OwnerClipTooBig", $"A clip is at most {MaxBytes / (1024 * 1024)} MB.");
            return null;
        }

        if (durationMs <= 0 || durationMs > MaxDurationMs)
        {
            problem = new("OwnerClipTooLong", $"A clip is at most {MaxDurationMs / 1000} seconds.");
            return null;
        }

        return new ScheduleOwnerClip(id, chainId, scheduleVersionId, sentBy, contentHash, mimeType, sizeBytes, durationMs, atUtc);
    }
}

/// <summary>
/// One message of the owner of a schedule about one of its works (<c>ssf.schedule_owner_messages</c>), written once and never changed (append-only by privilege).
/// <list type="bullet">
/// <item><b>Tip</b>: a clip about the work <see cref="TaskKey"/>.</item>
/// <item><b>Change</b>: a clip, and <see cref="NewVersionId"/> - a NEW version of the schedule that passed the check by someone other than its maker, whose task <see cref="TaskKey"/> is the "now".</item>
/// <item><b>Look</b>: a clip (the question), exactly two answers (words) and a follow-up clip for each, played after the answer.</item>
/// </list>
/// </summary>
public sealed class ScheduleOwnerMessage : Entity<Guid>
{
    public const int MaxAnswerLength = 80;

    private ScheduleOwnerMessage() : base(Guid.Empty) { } // EF Core

    private ScheduleOwnerMessage(
        Guid id, Guid chainId, Guid scheduleVersionId, string taskKey, ScheduleOwnerMessageKind kind, Guid clipId, Guid? newVersionId,
        string? answerFirst, string? answerSecond, Guid? followUpFirstClipId, Guid? followUpSecondClipId, UserId sentBy, DateTime atUtc)
        : base(id)
    {
        ChainId = chainId;
        ScheduleVersionId = scheduleVersionId;
        TaskKey = taskKey;
        Kind = kind;
        ClipId = clipId;
        NewVersionId = newVersionId;
        AnswerFirst = answerFirst;
        AnswerSecond = answerSecond;
        FollowUpFirstClipId = followUpFirstClipId;
        FollowUpSecondClipId = followUpSecondClipId;
        SentByUserId = sentBy;
        SentAtUtc = atUtc;
    }

    public Guid ChainId { get; private set; }

    /// <summary>The version of the schedule the message is about (for a change: the "before").</summary>
    public Guid ScheduleVersionId { get; private set; }

    public string TaskKey { get; private set; } = string.Empty;
    public ScheduleOwnerMessageKind Kind { get; private set; }
    public Guid ClipId { get; private set; }

    /// <summary>For a change: the checked version whose task is the "now". Null otherwise.</summary>
    public Guid? NewVersionId { get; private set; }

    /// <summary>For a look: the two answers, in words. Null otherwise.</summary>
    public string? AnswerFirst { get; private set; }

    public string? AnswerSecond { get; private set; }

    /// <summary>For a look: the owner's follow-up clip after the first / second answer. Null otherwise.</summary>
    public Guid? FollowUpFirstClipId { get; private set; }

    public Guid? FollowUpSecondClipId { get; private set; }

    public UserId SentByUserId { get; private set; }
    public DateTime SentAtUtc { get; private set; }

    public static ScheduleOwnerMessage? Create(
        Guid id, Guid chainId, Guid scheduleVersionId, string taskKey, ScheduleOwnerMessageKind kind, Guid clipId, Guid? newVersionId,
        string? answerFirst, string? answerSecond, Guid? followUpFirstClipId, Guid? followUpSecondClipId, UserId sentBy, DateTime atUtc, out ScheduleOwnerProblem? problem)
    {
        problem = null;
        if (id == Guid.Empty || chainId == Guid.Empty || scheduleVersionId == Guid.Empty || clipId == Guid.Empty || sentBy.IsEmpty || !Enum.IsDefined(kind))
        {
            problem = new("OwnerMessagePlace", "A message names its schedule, its work, its clip and who sent it.");
            return null;
        }

        if (!ScheduleTaskContent.IsValidKey(taskKey))
        {
            problem = new("OwnerMessageTask", "A message is about one work of the schedule.");
            return null;
        }

        answerFirst = answerFirst?.Trim();
        answerSecond = answerSecond?.Trim();
        switch (kind)
        {
            case ScheduleOwnerMessageKind.Tip:
                if (newVersionId is not null || answerFirst is not null || answerSecond is not null || followUpFirstClipId is not null || followUpSecondClipId is not null)
                {
                    problem = new("OwnerMessageShape", "A tip is one clip about one work; it has no new version, answers or follow-up.");
                    return null;
                }

                break;
            case ScheduleOwnerMessageKind.Change:
                if (newVersionId is null || newVersionId == Guid.Empty || newVersionId == scheduleVersionId
                    || answerFirst is not null || answerSecond is not null || followUpFirstClipId is not null || followUpSecondClipId is not null)
                {
                    problem = new("OwnerMessageShape", "A change points at the new version of the schedule, and has no answers or follow-up.");
                    return null;
                }

                break;
            default:
                if (newVersionId is not null
                    || string.IsNullOrWhiteSpace(answerFirst) || string.IsNullOrWhiteSpace(answerSecond)
                    || answerFirst.Length > MaxAnswerLength || answerSecond.Length > MaxAnswerLength
                    || string.Equals(answerFirst, answerSecond, StringComparison.Ordinal)
                    || followUpFirstClipId is null || followUpSecondClipId is null
                    || followUpFirstClipId == Guid.Empty || followUpSecondClipId == Guid.Empty)
                {
                    problem = new("OwnerMessageShape", $"A look has exactly two different answers of at most {MaxAnswerLength} characters, and a follow-up clip after each.");
                    return null;
                }

                break;
        }

        return new ScheduleOwnerMessage(
            id, chainId, scheduleVersionId, taskKey, kind, clipId, newVersionId, answerFirst, answerSecond, followUpFirstClipId, followUpSecondClipId, sentBy, atUtc);
    }

    /// <summary>The ids of every clip this message plays (the message, and for a look the two follow-ups).</summary>
    public IEnumerable<Guid> ClipIds()
    {
        yield return ClipId;
        if (FollowUpFirstClipId is { } first)
        {
            yield return first;
        }

        if (FollowUpSecondClipId is { } second)
        {
            yield return second;
        }
    }
}

/// <summary>What one follower-state row records.</summary>
public enum ScheduleOwnerStateKind : short
{
    /// <summary>The first full play of the message (its own count; never "done").</summary>
    Heard = 0,

    /// <summary>The farmer accepted a change.</summary>
    Accepted = 1,

    /// <summary>The farmer kept the old one.</summary>
    KeptOld = 2,

    /// <summary>The farmer took back an accepted change.</summary>
    TakenBack = 3,

    /// <summary>The farmer answered a look message (first or second).</summary>
    Answered = 4,
}

/// <summary>
/// One fact about what a farm's plot did with one owner message (<c>ssf.schedule_owner_message_states</c>): heard, decided (accepted / kept the old one / took it back) or answered.
/// APPEND-ONLY by privilege (SELECT and INSERT): a later decision never edits an earlier one, and history is kept (P3). An accept also records what it moved, so a take-back can
/// restore both exactly: the own work's revision before and after, whether the accept created the work, and the job (plan) and its words before.
/// </summary>
public sealed class ScheduleOwnerMessageState : Entity<Guid>
{
    public static readonly Guid IdNamespace = Guid.Parse("3e7a41c9-5b82-4d06-a1f3-9c2d8b6e0f47");

    private ScheduleOwnerMessageState() : base(Guid.Empty) { } // EF Core

    private ScheduleOwnerMessageState(
        Guid id, FarmId farmId, Guid plotId, Guid? cropCycleId, UserId farmOwner, Guid messageId, ScheduleOwnerStateKind kind, int sequence, short? answer, UserId by, DateTime atUtc)
        : base(id)
    {
        FarmId = farmId;
        PlotId = plotId;
        CropCycleId = cropCycleId;
        OwnerUserId = farmOwner;
        MessageId = messageId;
        Kind = kind;
        Sequence = sequence;
        Answer = answer;
        ByUserId = by;
        AtUtc = atUtc;
    }

    public FarmId FarmId { get; private set; }
    public Guid PlotId { get; private set; }

    /// <summary>The crop season a decision or an answer is about; null for a "heard" (it is the plot's).</summary>
    public Guid? CropCycleId { get; private set; }

    /// <summary>The owner of the farm when it was written (from the farm row, never a body).</summary>
    public UserId OwnerUserId { get; private set; }

    public Guid MessageId { get; private set; }
    public ScheduleOwnerStateKind Kind { get; private set; }

    /// <summary>1 for the first decision of the (plot-season, message), one more for each later one; 0 for a heard or an answer (once only).</summary>
    public int Sequence { get; private set; }

    /// <summary>For an answer: 0 = first, 1 = second.</summary>
    public short? Answer { get; private set; }

    /// <summary>For an accept: the own work it changed or made.</summary>
    public Guid? ItemId { get; private set; }

    /// <summary>For an accept: the work's revision before (null when the accept made the work) and after.</summary>
    public int? ItemRevisionBefore { get; private set; }

    public int? ItemRevisionAfter { get; private set; }

    /// <summary>For an accept: true when the work was NOT in the own schedule and the accept took the new one in (a take-back then takes it out again).</summary>
    public bool ItemCreated { get; private set; }

    /// <summary>For an accept: the job (plan) of the work that was changed, and its words before (so a take-back restores them); null when there was no open job.</summary>
    public Guid? JobId { get; private set; }

    public string? JobTitleBefore { get; private set; }
    public string? JobQuantityBefore { get; private set; }

    public UserId ByUserId { get; private set; }
    public DateTime AtUtc { get; private set; }

    /// <summary>The id of the once-only fact (heard / answered) of (plot, message): the same on every phone, so a re-sent row is the same row.</summary>
    public static Guid OnceIdFor(ScheduleOwnerStateKind kind, Guid plotId, Guid messageId) =>
        MoneyEntryIdentity.V5(IdNamespace, $"{(short)kind}:{plotId.ToString("D").ToLowerInvariant()}:{messageId.ToString("D").ToLowerInvariant()}");

    /// <summary>The id of decision number <paramref name="sequence"/> of (plot-season, message).</summary>
    public static Guid DecisionIdFor(Guid plotId, Guid cropCycleId, Guid messageId, int sequence) =>
        MoneyEntryIdentity.V5(
            IdNamespace,
            $"d:{plotId.ToString("D").ToLowerInvariant()}:{cropCycleId.ToString("D").ToLowerInvariant()}:{messageId.ToString("D").ToLowerInvariant()}:{sequence}");

    public static ScheduleOwnerMessageState Heard(FarmId farm, Guid plotId, UserId farmOwner, Guid messageId, UserId by, DateTime atUtc) =>
        new(OnceIdFor(ScheduleOwnerStateKind.Heard, plotId, messageId), farm, plotId, null, farmOwner, messageId, ScheduleOwnerStateKind.Heard, 0, null, by, atUtc);

    public static ScheduleOwnerMessageState Answered(
        FarmId farm, Guid plotId, Guid cropCycleId, UserId farmOwner, Guid messageId, short answer, UserId by, DateTime atUtc) =>
        new(OnceIdFor(ScheduleOwnerStateKind.Answered, plotId, messageId), farm, plotId, cropCycleId, farmOwner, messageId, ScheduleOwnerStateKind.Answered, 0, answer, by, atUtc);

    public static ScheduleOwnerMessageState Decided(
        FarmId farm, Guid plotId, Guid cropCycleId, UserId farmOwner, Guid messageId, ScheduleOwnerStateKind kind, int sequence, UserId by, DateTime atUtc)
    {
        if (kind is not (ScheduleOwnerStateKind.Accepted or ScheduleOwnerStateKind.KeptOld or ScheduleOwnerStateKind.TakenBack) || sequence < 1)
        {
            throw new ArgumentException("A decision is an accept, a keep of the old one or a take-back, and numbered from 1.");
        }

        return new(DecisionIdFor(plotId, cropCycleId, messageId, sequence), farm, plotId, cropCycleId, farmOwner, messageId, kind, sequence, null, by, atUtc);
    }

    /// <summary>Records what an accept moved (before it is saved).</summary>
    public void RecordMoved(Guid? itemId, int? revisionBefore, int? revisionAfter, bool itemCreated, Guid? jobId, string? jobTitleBefore, string? jobQuantityBefore)
    {
        ItemId = itemId;
        ItemRevisionBefore = revisionBefore;
        ItemRevisionAfter = revisionAfter;
        ItemCreated = itemCreated;
        JobId = jobId;
        JobTitleBefore = jobTitleBefore;
        JobQuantityBefore = jobQuantityBefore;
    }

    /// <summary>For a take-back: the work and job the accept it undoes moved (carried on the take-back row so a reading needs one row).</summary>
    public void RecordRestored(Guid? itemId, int? revisionAfter, Guid? jobId)
    {
        ItemId = itemId;
        ItemRevisionAfter = revisionAfter;
        JobId = jobId;
    }
}
