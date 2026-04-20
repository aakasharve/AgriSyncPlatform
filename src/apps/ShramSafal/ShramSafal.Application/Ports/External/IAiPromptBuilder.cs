namespace ShramSafal.Application.Ports.External;

public interface IAiPromptBuilder
{
    string BuildVoiceParsingPrompt(VoiceParseContext context);
    string BuildReceiptExtractionPrompt();
    string BuildPattiExtractionPrompt(string cropName);
}

public sealed record VoiceParseContext(
    List<CropInfo> AvailableCrops,
    FarmerProfileInfo Profile,
    FarmContextInfo? FarmContext,
    string? FocusCategory,
    VocabDatabaseInfo? VocabDb);

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
