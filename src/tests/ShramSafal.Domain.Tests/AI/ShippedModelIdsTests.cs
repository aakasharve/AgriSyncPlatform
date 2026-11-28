// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (founder's order 23 Nov 2026: Saaras v4; 28 Nov 2026: the sorting model
// is gemini-3.5-flash-lite, Sarvam is the backup - docs/ai/MODEL-SELECTION.md).
//
// A model id is a perishable fact, and it lives in four appsettings files as well as in the code defaults. This test keeps
// the shipped files and the code defaults saying the same thing, so one cannot be changed and the other forgotten.
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using ShramSafal.Domain.AI;
using ShramSafal.Infrastructure.AI;
using ShramSafal.Infrastructure.Integrations.Gemini;
using ShramSafal.Infrastructure.Integrations.Sarvam;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

public sealed class ShippedModelIdsTests
{
    private static string BootstrapperDirectory()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "AgriSync.sln")))
        {
            dir = dir.Parent;
        }

        Assert.NotNull(dir);
        return Path.Combine(dir!.FullName, "AgriSync.Bootstrapper");
    }

    public static IEnumerable<object[]> SettingsFiles() =>
    [
        ["appsettings.json"],
        ["appsettings.Production.json"],
        ["appsettings.Development.example.json"],
        ["appsettings.Development.json"],
    ];

    [Theory]
    [MemberData(nameof(SettingsFiles))]
    public void ShippedSettings_NameSaarasV4_ForRestAndStreaming(string file)
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(BootstrapperDirectory(), file)));
        var sarvam = doc.RootElement.GetProperty("Sarvam");

        Assert.Equal("saaras:v4", sarvam.GetProperty("SttModel").GetString());
        Assert.Equal("saaras:v4", sarvam.GetProperty("StreamingSttModel").GetString());
    }

    [Theory]
    [MemberData(nameof(SettingsFiles))]
    public void ShippedSettings_NameTheGemini35FlashLiteSorter_WithinItsOutputLimits_AndThinkingOff(string file)
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(BootstrapperDirectory(), file)));
        var gemini = doc.RootElement.GetProperty("Gemini");

        Assert.Equal(GeminiOptions.DefaultStructurerModelId, gemini.GetProperty("StructurerModelId").GetString());
        Assert.Equal("gemini-3.5-flash-lite", GeminiOptions.DefaultStructurerModelId);

        // The sorting call stays inside the model's 65,536 output tokens, with thinking off, and its own shorter deadline.
        var maxOutput = gemini.GetProperty("StructurerMaxOutputTokens").GetInt32();
        Assert.InRange(maxOutput, 1, GeminiOptions.StructurerMaxOutputTokensCeiling);
        Assert.Equal(0, gemini.GetProperty("StructurerThinkingBudget").GetInt32());
        Assert.InRange(gemini.GetProperty("StructurerTimeoutSeconds").GetInt32(), 1, gemini.GetProperty("TimeoutSeconds").GetInt32());

        // A pointer beside the model id, so nobody changes it without the decision record.
        Assert.Contains("docs/ai/MODEL-SELECTION.md", gemini.GetProperty("_note_StructurerModelId").GetString(), StringComparison.Ordinal);
    }

    [Theory]
    [MemberData(nameof(SettingsFiles))]
    public void ShippedSettings_SortWithGemini_AndSortOnceWithSarvamIfItFails(string file)
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(BootstrapperDirectory(), file)));
        var structurer = doc.RootElement.GetProperty("Ai").GetProperty("Structurer");

        Assert.Equal("Gemini", structurer.GetProperty("Provider").GetString());
        Assert.Equal("Sarvam", structurer.GetProperty("Fallback").GetString());

        // Speech-to-text is not part of this choice: it stays Sarvam Saaras v4.
        Assert.Equal("saaras:v4", doc.RootElement.GetProperty("Sarvam").GetProperty("SttModel").GetString());
    }

    [Theory]
    [MemberData(nameof(SettingsFiles))]
    public void ShippedSettings_BindToTheStructurerOptions_UnderTheSectionTheCodeReads(string file)
    {
        var configuration = new ConfigurationBuilder()
            .AddJsonFile(Path.Combine(BootstrapperDirectory(), file), optional: false)
            .Build();

        var options = new VoiceStructurerOptions();
        configuration.GetSection(VoiceStructurerOptions.SectionName).Bind(options);

        Assert.Equal("Ai:Structurer", VoiceStructurerOptions.SectionName);
        Assert.Equal(AiProviderType.Gemini, options.ResolveProvider("Sarvam", AiProviderType.Sarvam)); // the setting beats the database row
        Assert.Equal(AiProviderType.Sarvam, options.ResolveFallback(AiProviderType.Gemini));
    }

    [Fact]
    public void TheDecisionRecord_Exists_AndStatesTheRuleForChangingAModel()
    {
        var repoRoot = Directory.GetParent(BootstrapperDirectory())!.Parent!.FullName;
        var record = File.ReadAllText(Path.Combine(repoRoot, "docs", "ai", "MODEL-SELECTION.md"));

        Assert.Contains("gemini-3.5-flash-lite", record, StringComparison.Ordinal);
        Assert.Contains(
            "before any change of model for any AI step, re-run the side-by-side test on the golden set and update this file",
            record,
            StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void CodeDefaults_AndShippedSettings_AgreeOnTheSarvamModels()
    {
        var defaults = new SarvamOptions();

        Assert.Equal("saaras:v4", defaults.SttModel);
        Assert.Equal("saaras:v4", defaults.StreamingSttModel);
    }
}
