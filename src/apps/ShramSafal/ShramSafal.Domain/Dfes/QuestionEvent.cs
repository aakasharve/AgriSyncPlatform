using AgriSync.BuildingBlocks.Domain;

namespace ShramSafal.Domain.Dfes;

/// <summary>
/// DFES (dfes-companion-2026-07-11) — append-only telemetry row for the D8 question
/// engine (bank definition snapshot + what was actually shown / answered). Mapped to
/// <c>ssf.question_events</c>; the migration <c>REVOKE UPDATE, DELETE FROM agrisync_app</c>
/// so it is INSERT-only by privilege. Carries its own <see cref="FarmId"/> (direct RLS)
/// plus a nullable <see cref="DailyLogId"/> FK. NO user_id, NO farmer PII beyond the
/// optional free-text <see cref="Response"/> → farm-co-owned, KEEP on erasure.
/// <para>Phase 1 is the persistence shape. Selection, priority, cooldown and telemetry
/// stamping are Phase 5 — nothing in Phase 1 writes these rows.</para>
/// </summary>
public sealed class QuestionEvent : Entity<Guid>
{
    private QuestionEvent() : base(Guid.Empty) { } // EF Core

    private QuestionEvent(
        Guid id, Guid? dailyLogId, Guid farmId, Guid? plotId,
        string questionKey, string crop, string? expectedStage, string? actualStageApplicability,
        string anchorDateType, string triggerType, string questionType, string lens,
        int depthLevel, int priority, int cooldown, string answerModes, string safetyClass,
        bool agronomistApproved, bool marathiApproved, string bankVersion, string questionEngineVersion,
        Guid? answerObservationId, DateTime? shownAtUtc, string? triggerReason, string? weatherContext,
        string? response, bool? stageConfirmed, bool? photoSubmitted, bool? skipped, DateTime createdAtUtc)
        : base(id)
    {
        if (farmId == Guid.Empty)
            throw new ArgumentException("farmId is required — the direct RLS tenancy key.", nameof(farmId));
        if (string.IsNullOrWhiteSpace(questionKey))
            throw new ArgumentException("questionKey is required — the bank identity.", nameof(questionKey));

        DailyLogId = dailyLogId;
        FarmId = farmId;
        PlotId = plotId;
        QuestionKey = questionKey.Trim();
        Crop = crop;
        ExpectedStage = expectedStage;
        ActualStageApplicability = actualStageApplicability;
        AnchorDateType = anchorDateType;
        TriggerType = triggerType;
        QuestionType = questionType;
        Lens = lens;
        DepthLevel = depthLevel;
        Priority = priority;
        Cooldown = cooldown;
        AnswerModes = answerModes;
        SafetyClass = safetyClass;
        AgronomistApproved = agronomistApproved;
        MarathiApproved = marathiApproved;
        BankVersion = bankVersion;
        QuestionEngineVersion = questionEngineVersion;
        AnswerObservationId = answerObservationId;
        ShownAtUtc = shownAtUtc;
        TriggerReason = triggerReason;
        WeatherContext = weatherContext;
        Response = response;
        StageConfirmed = stageConfirmed;
        PhotoSubmitted = photoSubmitted;
        Skipped = skipped;
        CreatedAtUtc = createdAtUtc;
    }

    public Guid? DailyLogId { get; private set; }
    public Guid FarmId { get; private set; }
    public Guid? PlotId { get; private set; }
    public string QuestionKey { get; private set; } = null!;
    public string Crop { get; private set; } = null!;
    public string? ExpectedStage { get; private set; }
    public string? ActualStageApplicability { get; private set; }
    public string AnchorDateType { get; private set; } = null!;
    public string TriggerType { get; private set; } = null!;
    public string QuestionType { get; private set; } = null!;
    public string Lens { get; private set; } = null!;
    public int DepthLevel { get; private set; }
    public int Priority { get; private set; }
    public int Cooldown { get; private set; }
    public string AnswerModes { get; private set; } = null!;
    public string SafetyClass { get; private set; } = null!;
    public bool AgronomistApproved { get; private set; }
    public bool MarathiApproved { get; private set; }
    public string BankVersion { get; private set; } = null!;
    public string QuestionEngineVersion { get; private set; } = null!;
    public Guid? AnswerObservationId { get; private set; }
    public DateTime? ShownAtUtc { get; private set; }
    public string? TriggerReason { get; private set; }
    public string? WeatherContext { get; private set; }
    public string? Response { get; private set; }
    public bool? StageConfirmed { get; private set; }
    public bool? PhotoSubmitted { get; private set; }
    public bool? Skipped { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }

    public static QuestionEvent Create(
        Guid id, Guid? dailyLogId, Guid farmId, Guid? plotId,
        string questionKey, string crop, string? expectedStage, string? actualStageApplicability,
        string anchorDateType, string triggerType, string questionType, string lens,
        int depthLevel, int priority, int cooldown, string answerModes, string safetyClass,
        bool agronomistApproved, bool marathiApproved, string bankVersion, string questionEngineVersion,
        Guid? answerObservationId, DateTime? shownAtUtc, string? triggerReason, string? weatherContext,
        string? response, bool? stageConfirmed, bool? photoSubmitted, bool? skipped, DateTime createdAtUtc)
        => new(id, dailyLogId, farmId, plotId, questionKey, crop, expectedStage, actualStageApplicability,
               anchorDateType, triggerType, questionType, lens, depthLevel, priority, cooldown,
               answerModes, safetyClass, agronomistApproved, marathiApproved, bankVersion,
               questionEngineVersion, answerObservationId, shownAtUtc, triggerReason, weatherContext,
               response, stageConfirmed, photoSubmitted, skipped, createdAtUtc);
}
