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
