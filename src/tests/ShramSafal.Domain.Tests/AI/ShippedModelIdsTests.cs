// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (founder's order 23 Nov 2026: Saaras v4; Gemini structurer on its GA id).
//
// A model id is a perishable fact, and it lives in four appsettings files as well as in the code defaults. This test keeps
// the shipped files and the code defaults saying the same thing, so one cannot be changed and the other forgotten.
using System.Text.Json;
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
    public void ShippedSettings_NameTheGeminiStructurerOnItsGaId_NotThePreview(string file)
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(BootstrapperDirectory(), file)));

        Assert.Equal(
            GeminiOptions.DefaultStructurerModelId,
            doc.RootElement.GetProperty("Gemini").GetProperty("StructurerModelId").GetString());
        Assert.Equal("gemini-3.1-flash-lite", GeminiOptions.DefaultStructurerModelId);
    }

    [Fact]
    public void CodeDefaults_AndShippedSettings_AgreeOnTheSarvamModels()
    {
        var defaults = new SarvamOptions();

        Assert.Equal("saaras:v4", defaults.SttModel);
        Assert.Equal("saaras:v4", defaults.StreamingSttModel);
    }
}
