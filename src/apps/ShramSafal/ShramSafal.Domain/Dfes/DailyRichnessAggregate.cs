using AgriSync.BuildingBlocks.Domain;

namespace ShramSafal.Domain.Dfes;

/// <summary>
/// DFES (dfes-companion-2026-07-11) — DIRECT-<c>farm_id</c> per-day richness
/// aggregate (one row per farm per local calendar day), mapped to
/// <c>ssf.daily_richness_aggregates</c> with <c>UNIQUE(farm_id, local_date)</c>.
/// A DERIVED farm-level fact — NO user_id, NO farmer free-text → KEEP on erasure
/// (same posture as <c>RoutinePattern</c>). Direct RLS on <see cref="FarmId"/> (a RAW Guid).
/// <para>Phase 1 is the persistence shape only. Construct an UNSTAMPED row with the 5-arg
/// shell <see cref="Create(System.Guid,System.Guid,System.DateOnly,string,System.DateTimeOffset)"/>,
/// then stamp the scoring / classification / reward columns with
/// <see cref="ApplyDerivation"/> (and optionally <see cref="ConfirmStage"/>). The Phase-2
/// <c>DailyRichnessDerivationService.RecomputeAsync</c> drives that path idempotently using
/// <c>DfesTuning.*</c> (static); nothing in Phase 1 computes the columns.</para>
/// </summary>
public sealed class DailyRichnessAggregate : Entity<Guid>
{
    private DailyRichnessAggregate() : base(Guid.Empty) { } // EF Core

    // Shell ctor — an UNSTAMPED row (identity + tenancy + timestamps only).
    private DailyRichnessAggregate(
        Guid id, Guid farmId, DateOnly localDate, string timeZone, DateTime nowUtc)
        : base(id)
    {
        if (farmId == Guid.Empty)
            throw new ArgumentException("farmId is required — the direct RLS tenancy key.", nameof(farmId));
        if (localDate == default)
            throw new ArgumentException("localDate is required — one row per farm per local day.", nameof(localDate));
        if (string.IsNullOrWhiteSpace(timeZone))
            throw new ArgumentException("timeZone is required (default 'Asia/Kolkata').", nameof(timeZone));

        FarmId = farmId;
        LocalDate = localDate;
        TimeZone = timeZone;
        DayClassification = DayClassification.PendingReconciliation; // unstamped default
        ScoreEngineVersion = string.Empty;                          // stamped by ApplyDerivation
        RewardReasonsJson = "[]";
        ComponentsJson = "{}";
        CreatedAtUtc = nowUtc;
        UpdatedAtUtc = nowUtc;
    }

    public Guid FarmId { get; private set; }                        // direct RLS tenancy key (RAW Guid)
    public DateOnly LocalDate { get; private set; }                 // farm-local calendar day
    public string TimeZone { get; private set; } = "Asia/Kolkata";
    public int? ExecutionScore { get; private set; }
    public int? InsightScore { get; private set; }
    public int? LearningScore { get; private set; }
    public DayClassification DayClassification { get; private set; }
    public bool HasWork { get; private set; }
    public bool HasMeaningfulObservation { get; private set; }
    public bool HasLearning { get; private set; }
    public bool HasExperimentOutcome { get; private set; }
    public bool HasDisturbance { get; private set; }
    public bool HasDeclaredNoWorkReason { get; private set; }
    public bool AdvancesStreak { get; private set; }
    public bool AdvancesBar { get; private set; }
    public int ShramPointsEarned { get; private set; }
    public string RewardReasonsJson { get; private set; } = "[]";   // jsonb — reasons list
    public string? NoWorkReasonCode { get; private set; }
    public string? ExpectedStage { get; private set; }
    public string? FarmerConfirmedActualStage { get; private set; }
    public int? StageVarianceDays { get; private set; }
    public string ScoreEngineVersion { get; private set; } = string.Empty;
    public string ComponentsJson { get; private set; } = "{}";      // jsonb — per-dimension breakdown
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }

    /// <summary>Create an UNSTAMPED row (one per farm per local day). Stamp it with
    /// <see cref="ApplyDerivation"/> before it is persisted.</summary>
    public static DailyRichnessAggregate Create(
        Guid id, Guid farmId, DateOnly localDate, string timeZone, DateTimeOffset nowUtc)
        => new(id, farmId, localDate, timeZone, nowUtc.UtcDateTime);

    /// <summary>Create a fully-stamped row in one shot (Phase-2 recompute-and-overwrite path).</summary>
    public static DailyRichnessAggregate Create(
        Guid id, Guid farmId, DateOnly localDate, string timeZone,
        int? executionScore, int? insightScore, int? learningScore,
        DayClassification dayClassification, ContributingFlags flags,
        bool advancesStreak, bool advancesBar, int shramPoints,
        string rewardReasonsJson, string? noWorkReasonCode,
        string? expectedStage, string? farmerConfirmedActualStage, int? stageVarianceDays,
        string scoreEngineVersion, string componentsJson, DateTimeOffset nowUtc)
    {
        var a = new DailyRichnessAggregate(id, farmId, localDate, timeZone, nowUtc.UtcDateTime);
        a.ApplyDerivation(executionScore, insightScore, learningScore, dayClassification, flags,
            advancesStreak, advancesBar, shramPoints, rewardReasonsJson, noWorkReasonCode,
            scoreEngineVersion, componentsJson);
        a.ExpectedStage = expectedStage;
        a.FarmerConfirmedActualStage = farmerConfirmedActualStage;
        a.StageVarianceDays = stageVarianceDays;
        return a;
    }

    /// <summary>DFES — stamp the derived scoring / classification / reward columns.
    /// Idempotent overwrite (Phase-2 recompute calls this). No timestamp parameter by
    /// contract — <see cref="UpdatedAtUtc"/> is owned by the Phase-2 write path.</summary>
    public void ApplyDerivation(
        int? execScore, int? insightScore, int? learningScore,
        DayClassification classification, ContributingFlags flags,
        bool advancesStreak, bool advancesBar, int shramPoints,
        string rewardReasonsJson, string? noWorkReasonCode,
        string scoreEngineVersion, string componentsJson)
    {
        if (string.IsNullOrWhiteSpace(scoreEngineVersion))
            throw new ArgumentException("scoreEngineVersion is required — stamps which engine produced this row.", nameof(scoreEngineVersion));

        ExecutionScore = execScore;
        InsightScore = insightScore;
        LearningScore = learningScore;
        DayClassification = classification;
        HasWork = flags.HasWork;
        HasMeaningfulObservation = flags.HasMeaningfulObservation;
        HasLearning = flags.HasLearning;
        HasExperimentOutcome = flags.HasExperimentOutcome;
        HasDisturbance = flags.HasDisturbance;
        HasDeclaredNoWorkReason = flags.HasDeclaredNoWorkReason;
        AdvancesStreak = advancesStreak;
        AdvancesBar = advancesBar;
        ShramPointsEarned = shramPoints;
        RewardReasonsJson = rewardReasonsJson ?? "[]";
        NoWorkReasonCode = noWorkReasonCode;
        ScoreEngineVersion = scoreEngineVersion;
        ComponentsJson = componentsJson ?? "{}";
    }

    /// <summary>DFES — stamp the planned-vs-actual stage confirmation (D8).</summary>
    public void ConfirmStage(string expectedStage, string actualStage, int? varianceDays)
    {
        ExpectedStage = expectedStage;
        FarmerConfirmedActualStage = actualStage;
        StageVarianceDays = varianceDays;
    }
}
