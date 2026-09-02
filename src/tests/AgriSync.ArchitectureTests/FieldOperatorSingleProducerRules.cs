using System.Text.RegularExpressions;
using FluentAssertions;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// spec: 2026-09-01-labour-v2-r1, Phase 5 acceptance walk row 10 —
/// "anonymous stays anonymous" made structural. A FieldOperator is a work
/// IDENTITY (a name someone actually said); trust rules 10/11 and D9.12
/// forbid minting one from a crew count, a fuzzy name match, or a ledger
/// row. One production door creates them, so nothing downstream — ledger
/// build, crew display, sync, contradiction handling — can fabricate a
/// person as a side effect. Same idiom as LabourAnchorRules PIN 1.
/// </summary>
public sealed class FieldOperatorSingleProducerRules
{
    private const string ExpectedProducerPath =
        "apps/ShramSafal/ShramSafal.Application/UseCases/Labour/CreateFieldOperator/CreateFieldOperatorHandler.cs";

    [Fact]
    public void FieldOperator_is_constructed_in_exactly_one_production_file()
    {
        var producers = ProductionSourceFiles()
            .Where(path => StripComments(File.ReadAllText(path))
                .Contains("FieldOperator.Create(", StringComparison.Ordinal))
            .Select(Relative)
            .OrderBy(path => path, StringComparer.Ordinal)
            .ToArray();

        producers.Should().ContainSingle(
            "a FieldOperator is an identity someone stated, never a fabrication — a second " +
            "construction site means some code path can mint a person from a count or a guess " +
            $"(trust rules 10/11, D9.12). Found: [{string.Join(", ", producers)}]");

        producers[0].Should().Be(ExpectedProducerPath,
            "the single construction site must be the create-operator use case, " +
            "not whichever caller got there first");
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
