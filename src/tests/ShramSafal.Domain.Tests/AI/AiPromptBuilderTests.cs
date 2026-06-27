using ShramSafal.Application.Ports.External;
using ShramSafal.Infrastructure.AI;
using Microsoft.Extensions.Options;
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

    /// <summary>
    /// Phase 1.12 / SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 — the modular
    /// voice-parsing prompt must surface the five new voice-spine fields
    /// (`english`, `english_redacted`, `referenced_date`,
    /// `referenced_date_confidence`, `referenced_date_reason`) plus the
    /// `captured_at` context cue, so the Gemini structurer emits them
    /// alongside the legacy AgriLog bucket structure.
    /// </summary>
    [Fact]
    public void ModularVoicePrompt_ContainsVoiceSpineFields()
    {
        var builder = new AiPromptBuilder(
            new AiPromptTemplateRegistry(),
            Options.Create(new AiPromptOptions { UseModularPrompt = true }));

        var prompt = builder.BuildVoiceParsingPrompt(CreateContext());

        // Output-contract additions — the five new JSON field names must
        // appear verbatim in the assembled prompt so the model knows to
        // emit them.
        Assert.Contains("english", prompt, StringComparison.Ordinal);
        Assert.Contains("english_redacted", prompt, StringComparison.Ordinal);
        Assert.Contains("referenced_date", prompt, StringComparison.Ordinal);
        Assert.Contains("referenced_date_confidence", prompt, StringComparison.Ordinal);
        Assert.Contains("referenced_date_reason", prompt, StringComparison.Ordinal);

        // Redaction-token families (the model must use these exact tokens
        // when populating english_redacted).
        Assert.Contains("[FARMER_N]", prompt, StringComparison.Ordinal);
        Assert.Contains("[PHONE_N]", prompt, StringComparison.Ordinal);
        Assert.Contains("[PLOT_N]", prompt, StringComparison.Ordinal);
        Assert.Contains("[WORKER_N]", prompt, StringComparison.Ordinal);
        Assert.Contains("[VENDOR_N]", prompt, StringComparison.Ordinal);

        // systemBase.md instructs the model to resolve temporal cues
        // against `captured_at` rather than wall-clock time.
        Assert.Contains("captured_at", prompt, StringComparison.Ordinal);
    }

    /// <summary>
    /// The audit `PromptContentHash` (stamped on every AI-derived row per
    /// DATA_PRINCIPLE_SPINE 01.2) must be non-empty and deterministic
    /// across consecutive calls — drift in the prompt module content
    /// must change the hash, but two reads of the same on-disk prompt
    /// content must produce the same hash.
    /// </summary>
    [Fact]
    public void VoicePromptContentHash_IsStableAndNonEmpty()
    {
        var registry = new AiPromptTemplateRegistry();

        var firstHash = registry.CurrentVoicePromptContentHash;
        var secondHash = registry.CurrentVoicePromptContentHash;

        Assert.False(string.IsNullOrWhiteSpace(firstHash), "Prompt content hash must not be empty.");
        Assert.Equal(64, firstHash.Length); // SHA-256 hex string
        Assert.Equal(firstHash, secondHash);
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

    [Fact]
    public void ModularVoicePrompt_ContainsVersionedBucketModules()
    {
        var builder = new AiPromptBuilder(
            new AiPromptTemplateRegistry(),
            Options.Create(new AiPromptOptions { UseModularPrompt = true }));

        var prompt = builder.BuildVoiceParsingPrompt(CreateContext());

        Assert.Contains("AGRISYNC_PROMPT_VERSION", prompt, StringComparison.Ordinal);
        Assert.Contains("Visible Bucket: workDone", prompt, StringComparison.Ordinal);
        Assert.Contains("Visible Bucket: inputs", prompt, StringComparison.Ordinal);
        Assert.Contains("INNER MODIFIER", prompt, StringComparison.Ordinal);
        Assert.Contains("Return this JSON shape exactly", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("\"crop_activity\"", prompt, StringComparison.Ordinal);
    }

    /// <summary>
    /// AI_INTELLIGENCE_PLAN_2026-06-25 W1.P0 Component 8 — anti-leakage guard.
    /// When a confirmed CropStage is present the modular prompt must:
    /// (a) contain the scoped CROP_STAGE_LEAKAGE rule (not the blanket ban),
    /// (b) contain the GROWTH STAGE soft-prior block with the stage value,
    /// (c) contain the explicit no-autofill instruction.
    /// </summary>
    [Fact]
    public void ModularVoicePrompt_WithCropStage_ContainsStagePriorAndScopedLeakageRule()
    {
        var builder = new AiPromptBuilder(
            new AiPromptTemplateRegistry(),
            Options.Create(new AiPromptOptions { UseModularPrompt = true }));

        var context = CreateContext() with { CropStage = "dormancy" };
        var prompt = builder.BuildVoiceParsingPrompt(context);

        // Scoped rule must be present (one occurrence per bucket is enough — assert the key phrase).
        Assert.Contains(
            "infer stage from explicit OPERATIONS",
            prompt,
            StringComparison.OrdinalIgnoreCase);

        // The blanket per-bucket bans must NOT appear verbatim.
        Assert.DoesNotContain("assuming standard spray products", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("assuming pruning labour from crop stage", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("assuming irrigation need from stage", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("assuming machinery need from season", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("assuming disease from stage", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("adding tasks not spoken", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("assuming packaging during harvest", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("assuming standard seasonal tasks without speech evidence", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("do not infer disease blocker from crop stage", prompt, StringComparison.OrdinalIgnoreCase);

        // Stage-prior block must appear with the confirmed stage value.
        Assert.Contains("GROWTH STAGE (soft prior", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("dormancy", prompt, StringComparison.OrdinalIgnoreCase);

        // No-autofill instruction must be explicit.
        Assert.Contains("do NOT autofill", prompt, StringComparison.OrdinalIgnoreCase);

        // Candidate ops for dormancy stage must be present.
        Assert.Contains("dormancy_paste", prompt, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// AI_INTELLIGENCE_PLAN_2026-06-25 W1.P0 Component 8 — product-only
    /// anti-leakage guard. A context with NO CropStage must NOT emit the
    /// GROWTH STAGE block, ensuring a product name alone cannot trigger
    /// stage injection.
    /// </summary>
    [Fact]
    public void ModularVoicePrompt_WithoutCropStage_DoesNotEmitStagePriorBlock()
    {
        var builder = new AiPromptBuilder(
            new AiPromptTemplateRegistry(),
            Options.Create(new AiPromptOptions { UseModularPrompt = true }));

        // Context with no stage (product-only scenario).
        var context = CreateContext() with { CropStage = null };
        var prompt = builder.BuildVoiceParsingPrompt(context);

        // The growth-stage prior block must be absent when no stage is confirmed.
        Assert.DoesNotContain("GROWTH STAGE (soft prior", prompt, StringComparison.OrdinalIgnoreCase);
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
