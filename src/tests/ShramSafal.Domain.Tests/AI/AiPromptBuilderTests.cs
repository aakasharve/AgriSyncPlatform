using ShramSafal.Application.Ports.External;
using ShramSafal.Infrastructure.AI;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

public sealed class AiPromptBuilderTests
{
    private readonly AiPromptBuilder _builder = new();

    [Fact]
    public void VoicePrompt_ContainsCriticalContractSections()
    {
        var prompt = _builder.BuildVoiceParsingPrompt(CreateContext());

        Assert.Contains("IMPORTANT SECURITY OVERRIDE & OUTPUT RULES", prompt, StringComparison.Ordinal);
        Assert.Contains("MARATHI VOCABULARY MAPPINGS", prompt, StringComparison.Ordinal);
        Assert.Contains("OUTPUT SHAPE (JSON)", prompt, StringComparison.Ordinal);
        Assert.Contains("FEW SHOT EXAMPLES", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public void ReceiptPrompt_ContainsCategoryList()
    {
        var prompt = _builder.BuildReceiptExtractionPrompt();

        Assert.Contains("FERTILIZER", prompt, StringComparison.Ordinal);
        Assert.Contains("PESTICIDE", prompt, StringComparison.Ordinal);
        Assert.Contains("MACHINERY_RENTAL", prompt, StringComparison.Ordinal);
        Assert.Contains("EQUIPMENT_REPAIR", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public void PattiPrompt_IncludesCropName()
    {
        const string cropName = "Grapes";
        var prompt = _builder.BuildPattiExtractionPrompt(cropName);

        Assert.Contains(cropName, prompt, StringComparison.Ordinal);
    }

    [Fact]
    public void VoicePrompt_LengthIsWithinExpectedBounds()
    {
        var prompt = _builder.BuildVoiceParsingPrompt(CreateContext());

        Assert.True(prompt.Length > 2000, $"Prompt appears too short: {prompt.Length}");
        Assert.True(prompt.Length < 30000, $"Prompt appears unexpectedly long: {prompt.Length}");
    }

    private static VoiceParseContext CreateContext()
    {
        return new VoiceParseContext(
            AvailableCrops:
            [
                new CropInfo(
                    "crop-1",
                    "Grapes",
                    [
                        new PlotInfo(
                            "plot-1",
                            "North Plot",
                            new PlotInfrastructureInfo("drip", "motor-1", new DripDetailsInfo(400m)),
                            new IrrigationPlanInfo(45))
                    ])
            ],
            Profile: new FarmerProfileInfo(
                Motors: [new MotorInfo("motor-1", "Main Pump", 7.5m, "water-1")],
                WaterResources: [new WaterResourceInfo("water-1", "Well")],
                Machineries: [new MachineryInfo("Sprayer", "Sprayer", "20L")],
                LedgerDefaults: new LedgerDefaultsInfo(
                    new IrrigationDefaultInfo("drip", 45),
                    new LabourDefaultInfo(450m))),
            FarmContext: new FarmContextInfo(
                [
                    new SelectedCropContext(
                        "crop-1",
                        "Grapes",
                        ["plot-1"],
                        ["North Plot"])
                ]),
            FocusCategory: "irrigation",
            VocabDb: new VocabDatabaseInfo(
                [
                    new VocabMappingInfo(
                        "फवारा",
                        "spray",
                        "inputs",
                        "orchard",
                        true,
                        0.92m,
                        "Grapes")
                ]));
    }
}
