using AgriSync.BuildingBlocks.Domain;

namespace ShramSafal.Domain.Dfes;

/// <summary>
/// Lane DFES-Q (founder D-E, 2026-11-21) — the check of one photo a farmer gave as proof of an observation ("10 पैकी 7
/// काड्यांवर कळ्या फुटल्या"). Mapped to <c>ssf.question_photo_checks</c>: append-only BY PRIVILEGE (REVOKE UPDATE, DELETE,
/// TRUNCATE from the app role) and direct-farm_id RLS, like <c>ssf.question_events</c>. The answer row is never changed by a
/// check: a check is its own row, linked by <see cref="QuestionEventId"/>.
///
/// <para>A photo confirms only what it shows (one cane is not ten): <see cref="Verdict"/> is one of <see cref="Verdicts"/>, and
/// the rule that picks it lives with the check, not here.</para>
/// </summary>
public sealed class QuestionPhotoCheck : Entity<Guid>
{
    public static readonly IReadOnlySet<string> Verdicts = new HashSet<string>(StringComparer.Ordinal)
    {
        "matches", "does_not_match", "unclear", "not_enough",
    };

    private QuestionPhotoCheck() : base(Guid.Empty) { } // EF Core

    private QuestionPhotoCheck(
        Guid id, Guid farmId, Guid questionEventId, Guid attachmentId,
        int? statedCount, int? statedOutOf, int? readCount, int? readOutOf, decimal? confidence,
        string verdict, string model, string? detailJson, DateTime readAtUtc, DateTime createdAtUtc)
        : base(id)
    {
        if (farmId == Guid.Empty) throw new ArgumentException("farmId is required — the direct RLS tenancy key.", nameof(farmId));
        if (questionEventId == Guid.Empty) throw new ArgumentException("questionEventId is required.", nameof(questionEventId));
        if (attachmentId == Guid.Empty) throw new ArgumentException("attachmentId is required.", nameof(attachmentId));
        if (!Verdicts.Contains(verdict)) throw new ArgumentException($"Unknown verdict '{verdict}'.", nameof(verdict));
        if (string.IsNullOrWhiteSpace(model)) throw new ArgumentException("model is required.", nameof(model));

        FarmId = farmId;
        QuestionEventId = questionEventId;
        AttachmentId = attachmentId;
        StatedCount = statedCount;
        StatedOutOf = statedOutOf;
        ReadCount = readCount;
        ReadOutOf = readOutOf;
        Confidence = confidence;
        Verdict = verdict;
        Model = model.Trim();
        DetailJson = detailJson;
        ReadAtUtc = readAtUtc;
        CreatedAtUtc = createdAtUtc;
    }

    public Guid FarmId { get; private set; }
    public Guid QuestionEventId { get; private set; }
    public Guid AttachmentId { get; private set; }
    public int? StatedCount { get; private set; }
    public int? StatedOutOf { get; private set; }
    public int? ReadCount { get; private set; }
    public int? ReadOutOf { get; private set; }
    public decimal? Confidence { get; private set; }
    public string Verdict { get; private set; } = null!;
    public string Model { get; private set; } = null!;
    public string? DetailJson { get; private set; }
    public DateTime ReadAtUtc { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }

    public static QuestionPhotoCheck Create(
        Guid id, Guid farmId, Guid questionEventId, Guid attachmentId,
        int? statedCount, int? statedOutOf, int? readCount, int? readOutOf, decimal? confidence,
        string verdict, string model, string? detailJson, DateTime readAtUtc, DateTime createdAtUtc)
        => new(id, farmId, questionEventId, attachmentId, statedCount, statedOutOf, readCount, readOutOf, confidence,
               verdict, model, detailJson, readAtUtc, createdAtUtc);
}
