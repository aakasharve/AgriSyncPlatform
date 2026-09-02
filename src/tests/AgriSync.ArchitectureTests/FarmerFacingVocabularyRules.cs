using System.Text.RegularExpressions;
using FluentAssertions;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// Phase 5 Task 5.3 (founder master review 2026-09-02, D5) — the server half.
/// A Devanagari string literal in ShramSafal production code is farmer-facing
/// by construction (Marathi exists in this codebase for exactly one reader).
/// None may carry Latin permission vocabulary or a hardcoded English ON/OFF.
/// The contradiction contract deliberately has no text member — the server
/// never composes a farmer-facing sentence; this pin keeps both true.
/// </summary>
public sealed class FarmerFacingVocabularyRules
{
    [Fact]
    public void No_farmer_facing_server_string_carries_permission_vocabulary()
    {
        var stringLiteral = new Regex("\"(?:[^\"\\\\]|\\\\.)*\"");
        var devanagari = new Regex(@"[ऀ-ॿ]");
        var vocabulary = new Regex(
            @"\b(permissions?|grants?|granted|roles?|claims?|polic(?:y|ies)|access)\b",
            RegexOptions.IgnoreCase);
        var hardcodedOnOff = new Regex(@"(?<![A-Za-z])(?:ON|OFF)(?![A-Za-z])");

        var offenders = new List<string>();
        foreach (var path in ProductionSourceFiles()
            .Where(p => Relative(p).StartsWith("apps/ShramSafal/", StringComparison.Ordinal)))
        {
            var source = StripComments(File.ReadAllText(path));
            foreach (Match match in stringLiteral.Matches(source))
            {
                if (!devanagari.IsMatch(match.Value)) continue;
                if (vocabulary.IsMatch(match.Value) || hardcodedOnOff.IsMatch(match.Value))
                {
                    offenders.Add($"{Relative(path)}: {match.Value}");
                }
            }
        }

        offenders.Should().BeEmpty(
            "the farmer's words are जबाबदारी, not permission/grant/role/claim/policy/access — " +
            "a Marathi string carrying our vocabulary teaches him OUR model instead of " +
            $"remembering his (D5, 2026-09-02). Offenders: [{string.Join(", ", offenders)}]");
    }

    // ── copied from LabourAnchorRules (private there; copy, do not import) ──

    private static IEnumerable<string> ProductionSourceFiles()
    {
        var srcRoot = TestPathHelper.GetSolutionRoot();

        return Directory
            .EnumerateFiles(srcRoot, "*.cs", SearchOption.AllDirectories)
            .Where(path =>
                !path.Contains($"{Path.DirectorySeparatorChar}tests{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase) &&
                !path.Contains($"{Path.DirectorySeparatorChar}Migrations{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase) &&
                !path.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase) &&
                !path.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase));
    }

    private static string Relative(string fullPath) =>
        Path.GetRelativePath(TestPathHelper.GetSolutionRoot(), fullPath).Replace('\\', '/');

    private static string StripComments(string source)
    {
        var withoutBlockComments = Regex.Replace(source, @"/\*.*?\*/", string.Empty, RegexOptions.Singleline);
        return Regex.Replace(withoutBlockComments, @"^[^\S\r\n]*//.*$", string.Empty, RegexOptions.Multiline);
    }
}
