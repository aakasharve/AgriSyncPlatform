// spec: voice-instant-phase-a-2026-11-23 (Tasks 0 and 5) - the shipped settings and the one line in Program.cs that the
// phone's Server-Timing read depends on.
//
// Authored from the acceptance criteria only. Like ShippedModelIdsTests, the Bootstrapper folder is found by walking up
// to AgriSync.sln. Nothing is started: the JSON files are read through the same configuration provider the host uses, so
// the exact key paths ("Sarvam:SttMaxParallelPieces", "Ai:Structuring:MaxParallel") are the ones proven.
using System.Text.RegularExpressions;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

public sealed class VoiceSpeedSettingsTests
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

    public static IEnumerable<object[]> AllFourSettingsFiles() =>
    [
        ["appsettings.json"],
        ["appsettings.Production.json"],
        ["appsettings.Development.json"],
        ["appsettings.Development.example.json"],
    ];

    private static IConfigurationRoot Load(string file) =>
        new ConfigurationBuilder()
            .AddJsonFile(Path.Combine(BootstrapperDirectory(), file), optional: false, reloadOnChange: false)
            .Build();

    [Theory]
    [MemberData(nameof(AllFourSettingsFiles))]
    public void Every_shipped_settings_file_says_four_speech_pieces_at_once(string file)
    {
        Assert.Equal("4", Load(file)["Sarvam:SttMaxParallelPieces"]);
    }

    [Theory]
    [MemberData(nameof(AllFourSettingsFiles))]
    public void Every_shipped_settings_file_says_four_sorting_segments_at_once(string file)
    {
        Assert.Equal("4", Load(file)["Ai:Structuring:MaxParallel"]);
    }

    [Theory]
    [MemberData(nameof(AllFourSettingsFiles))]
    public void The_two_settings_sit_beside_the_ones_they_already_shared_a_file_with(string file)
    {
        // Guards against the lines landing under the wrong parent (a value under the wrong section is silently ignored).
        var settings = Load(file);

        Assert.NotNull(settings.GetSection("Sarvam")["SttModel"]);
        Assert.NotNull(settings.GetSection("Sarvam")["SttMaxParallelPieces"]);
        Assert.NotNull(settings.GetSection("Ai:Structuring")["MaxParallel"]);
        Assert.Null(settings["SttMaxParallelPieces"]);
        Assert.Null(settings["MaxParallel"]);
    }

    // ---- CORS: the phone can only read Server-Timing if the browser is told it may ----

    /// <summary>
    /// SOURCE PIN, not a behaviour test: the CORS policy is built inside Program.cs, which a unit test cannot start
    /// cheaply. This reads the file and checks the AllowFrontend policy exposes the Server-Timing response header in code
    /// (a line that is only commented out does not count).
    /// </summary>
    [Fact]
    public void The_AllowFrontend_cors_policy_exposes_the_Server_Timing_header_source_pin()
    {
        var program = File.ReadAllText(Path.Combine(BootstrapperDirectory(), "Program.cs"));

        var policyAt = program.IndexOf("AddPolicy(\"AllowFrontend\"", StringComparison.Ordinal);
        Assert.True(policyAt >= 0, "the AllowFrontend CORS policy was not found in Program.cs");
        var endAt = program.IndexOf("AllowCredentials()", policyAt, StringComparison.Ordinal);
        Assert.True(endAt > policyAt, "the end of the AllowFrontend policy chain was not found");
        var policy = WithoutLineComments(program[policyAt..endAt]);

        Assert.Matches(new Regex(@"\.WithExposedHeaders\([^)]*""Server-Timing""[^)]*\)"), policy);
    }

    private static string WithoutLineComments(string source)
    {
        var kept = new List<string>();
        foreach (var line in source.Split((char)10))
        {
            var inString = false;
            var cut = -1;
            for (var i = 0; i < line.Length; i++)
            {
                if (line[i] == (char)34 && (i == 0 || line[i - 1] != (char)92))
                {
                    inString = !inString;
                }
                else if (!inString && line[i] == (char)47 && i + 1 < line.Length && line[i + 1] == (char)47)
                {
                    cut = i;
                    break;
                }
            }

            kept.Add(cut >= 0 ? line[..cut] : line);
        }

        return string.Join(Environment.NewLine, kept);
    }
}
