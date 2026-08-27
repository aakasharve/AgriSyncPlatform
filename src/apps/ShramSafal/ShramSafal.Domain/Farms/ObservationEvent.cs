using AgriSync.BuildingBlocks.Domain;

namespace ShramSafal.Domain.Farms;

/// <summary>
/// Track B typed CHILD of <c>daily_logs</c> (ADR 0023 §1/§2) — the farmer's free-text
/// observation / wisdom alongside the structured log. EXISTS-join child: plain
/// <see cref="DailyLogId"/> FK, no farm_id, no Provenance, no version chain.
/// <para>The free-text (<see cref="TextRaw"/>) is <b>PRESERVED</b> per founder directive
/// D-FREETEXT-PRESERVE-2026-06-29 — KEEP on erasure, never scrubbed. Team-routing fields
/// deferred to B-FT2.</para>
/// </summary>
public sealed class ObservationEvent : Entity<Guid>
{
    private ObservationEvent() : base(Guid.Empty) { } // EF Core

    private ObservationEvent(
        Guid id, Guid dailyLogId, Guid? plotId, ObservationNoteType noteType,
        ObservationSeverity severity, ObservationSource source, string textRaw,
        string? textCleaned, string? tagsJson, Guid? linkedActivityId, DateTime createdAtUtc)
        : base(id)
    {
        if (string.IsNullOrWhiteSpace(textRaw))
        {
            throw new ArgumentException(
                "textRaw is required — the observation free-text is the load-bearing content.",
                nameof(textRaw));
        }

        DailyLogId = dailyLogId;
        PlotId = plotId;
        NoteType = noteType;
        Severity = severity;
        Source = source;
        TextRaw = textRaw.Trim();
        TextCleaned = textCleaned;
        TagsJson = tagsJson;
        LinkedActivityId = linkedActivityId;
        CreatedAtUtc = createdAtUtc;
    }

    public Guid DailyLogId { get; private set; }
    public Guid? PlotId { get; private set; }
    public ObservationNoteType NoteType { get; private set; }
    public ObservationSeverity Severity { get; private set; }
    public ObservationSource Source { get; private set; }
    public string TextRaw { get; private set; } = null!;     // farmer's exact words — preserved
    public string? TextCleaned { get; private set; }         // optional tidied version
    public string? TagsJson { get; private set; }            // serialized JSON array; null = none
    public Guid? LinkedActivityId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }

    // ── DFES InsightEntry facets (dfes-companion-2026-07-11) ─────────────
    // Nullable; PRESERVED on erasure alongside TextRaw (D-FREETEXT-PRESERVE-2026-06-29).
    // Populated by the Phase-2 derivation / Phase-5 answer path; Phase 1 only adds the shape.
    public string? Observation { get; private set; }
    public string? Change { get; private set; }
    public string? Comparison { get; private set; }
    public string? Challenge { get; private set; }
    public string? Uncertainty { get; private set; }
    public string? Hypothesis { get; private set; }
    public string? Evidence { get; private set; }
    public string? Learning { get; private set; }
    public string? NextAction { get; private set; }
    public string? CropStage { get; private set; }
    public string? FarmerConfirmedSummary { get; private set; }
    public Guid? SourceQuestionId { get; private set; }

    /// <summary>DFES — attach/overwrite the structured InsightEntry facets (all nullable).</summary>
    public void ApplyInsightEntry(
        string? observation, string? change, string? comparison, string? challenge,
        string? uncertainty, string? hypothesis, string? evidence, string? learning,
        string? nextAction, string? cropStage, string? farmerConfirmedSummary, Guid? sourceQuestionId)
    {
        Observation = observation;
        Change = change;
        Comparison = comparison;
        Challenge = challenge;
        Uncertainty = uncertainty;
        Hypothesis = hypothesis;
        Evidence = evidence;
        Learning = learning;
        NextAction = nextAction;
        CropStage = cropStage;
        FarmerConfirmedSummary = farmerConfirmedSummary;
        SourceQuestionId = sourceQuestionId;
    }

    public static ObservationEvent Create(
        Guid id, Guid dailyLogId, Guid? plotId, ObservationNoteType noteType,
        ObservationSeverity severity, ObservationSource source, string textRaw,
        string? textCleaned, string? tagsJson, Guid? linkedActivityId, DateTime createdAtUtc)
        => new(id, dailyLogId, plotId, noteType, severity, source, textRaw,
               textCleaned, tagsJson, linkedActivityId, createdAtUtc);
}
