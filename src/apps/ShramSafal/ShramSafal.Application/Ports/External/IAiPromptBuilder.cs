namespace ShramSafal.Application.Ports.External;

public interface IAiPromptBuilder
{
    string BuildVoiceParsingPrompt(VoiceParseContext context);
    string BuildReceiptExtractionPrompt();
    string BuildPattiExtractionPrompt(string cropName);

    // Full 64-char SHA-256 of the assembled voice-parsing prompt modules.
    // Threaded into Provenance.PromptContentHash on every AI-derived row.
    // Defined by DATA_PRINCIPLE_SPINE Phase 01 sub-phase 01.2.
    string CurrentVoicePromptContentHash { get; }
}

public sealed record VoiceParseContext(
    List<CropInfo> AvailableCrops,
    FarmerProfileInfo Profile,
    FarmContextInfo? FarmContext,
    string? FocusCategory,
    VocabDatabaseInfo? VocabDb)
{
    /// <summary>
    /// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.4 — ISO-8601 UTC
    /// instant the audio was recorded. Threaded into the structurer prompt
    /// via the <c>{{captured_at}}</c> placeholder so the model resolves
    /// temporal cues ("आज" / "काल" / "मागच्या सोमवारी") against the actual
    /// capture moment rather than the prompt-evaluation wall-clock.
    ///
    /// <para>
    /// Defaulted to <c>null</c> (init-only property) so legacy call sites
    /// — including the streaming parse path and the eval-only path —
    /// compile without diff. The 2-stage orchestrator method
    /// (<c>ParseVoiceTwoStageAsync</c>) populates it from the audio-blob
    /// metadata; the prompt builder substitutes <c>"unknown"</c> when the
    /// value is absent.
    /// </para>
    /// </summary>
    public DateTime? CapturedAtUtc { get; init; }

    /// <summary>
    /// AI_INTELLIGENCE_PLAN_2026-06-25 W1.P0 Component 8 — the confirmed
    /// growth stage for the crop cycle being logged (e.g. "dormancy",
    /// "berry_development", "pruning"). Sourced from
    /// <c>CropCycle.Stage</c> and threaded here so <c>AiPromptBuilder</c>
    /// can emit a soft stage-prior block without autofilling. Null-safe:
    /// absent when no crop cycle is selected or stage is unset.
    /// </summary>
    public string? CropStage { get; init; }

    /// <summary>
    /// PLR lane AI-2 (register F71) — set only when the farmer is speaking a CHANGE to one saved entry (the "बदला"
    /// screen): that entry's current parts, in the parse's own bucket shape (<c>{"inputs":[…],"irrigation":[…]}</c>).
    /// The prompt then reads "X नाही, Y" as "X becomes Y" in the matching part instead of a new observation.
    /// Sent by the phone inside the existing parse context (<c>context</c> / <c>contextJson</c>) as
    /// <c>correctionOf</c>; additive and optional — an older app never sends it and is parsed exactly as before.
    /// </summary>
    public System.Text.Json.JsonElement? CorrectionOf { get; init; }

    /// <summary>
    /// PLR lane V-1 fix pass 3 (register F74) — the same context with every list present and no null item. A context
    /// read from a phone's JSON can leave out any part (an older app, a partial profile — <c>"profile": {}</c>), and
    /// <c>System.Text.Json</c> then leaves those lists null although they are declared non-null; reading them
    /// crashed the parse with HTTP 500. Absent reads as empty ("not provided" in the prompt), never as an error.
    /// </summary>
    public VoiceParseContext WithoutNulls() => this with
    {
        AvailableCrops = Present(AvailableCrops).Select(c => c with { Plots = Present(c.Plots) }).ToList(),
        Profile = Profile is null
            ? new FarmerProfileInfo([], [], [], null)
            : Profile with
            {
                Motors = Present(Profile.Motors),
                WaterResources = Present(Profile.WaterResources),
                Machineries = Present(Profile.Machineries),
            },
        FarmContext = FarmContext is null
            ? null
            : new FarmContextInfo(Present(FarmContext.Selection)
                .Select(s => s with { SelectedPlotIds = Present(s.SelectedPlotIds), SelectedPlotNames = Present(s.SelectedPlotNames) })
                .ToList()),
        VocabDb = VocabDb is null ? null : new VocabDatabaseInfo(Present(VocabDb.Mappings)),
    };

    private static List<T> Present<T>(List<T>? items) => items is null ? [] : items.Where(x => x is not null).ToList();
}

public sealed record CropInfo(string Id, string Name, List<PlotInfo> Plots);
public sealed record PlotInfo(string Id, string Name, PlotInfrastructureInfo? Infrastructure, IrrigationPlanInfo? IrrigationPlan);
public sealed record PlotInfrastructureInfo(string? IrrigationMethod, string? LinkedMotorId, DripDetailsInfo? DripDetails);
public sealed record DripDetailsInfo(decimal? FlowRatePerHour);
public sealed record IrrigationPlanInfo(int? DurationMinutes);
public sealed record FarmerProfileInfo(
    List<MotorInfo> Motors,
    List<WaterResourceInfo> WaterResources,
    List<MachineryInfo> Machineries,
    LedgerDefaultsInfo? LedgerDefaults);
public sealed record MotorInfo(string Id, string Name, decimal Hp, string? LinkedWaterSourceId);
public sealed record WaterResourceInfo(string Id, string Name);
public sealed record MachineryInfo(string Name, string Type, string? Capacity);
public sealed record LedgerDefaultsInfo(IrrigationDefaultInfo? Irrigation, LabourDefaultInfo? Labour);
public sealed record IrrigationDefaultInfo(string Method, int DefaultDuration);
public sealed record LabourDefaultInfo(decimal DefaultWage);
public sealed record FarmContextInfo(List<SelectedCropContext> Selection);
public sealed record SelectedCropContext(string CropId, string CropName, List<string> SelectedPlotIds, List<string> SelectedPlotNames);
public sealed record VocabDatabaseInfo(List<VocabMappingInfo> Mappings);
public sealed record VocabMappingInfo(
    string Colloquial,
    string Standard,
    string Category,
    string Context,
    bool ApprovedByUser,
    decimal Confidence,
    string? CropType);
