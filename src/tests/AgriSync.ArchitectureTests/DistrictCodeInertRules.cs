using FluentAssertions;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// Locks the inert-v1 guarantee: the geo/dialect rails on the typed ledger
/// (<c>FarmOperation.DistrictCode</c> / <c>FarmOperation.DialectRegion</c>) are
/// ADR §3 forward-rails that stay NULL in v1 (D3 — no reader, no writer). This
/// test fails the build the moment any Application UseCase source starts
/// reading or writing those fields, so the "inert" claim can never silently rot.
/// Mirrors <see cref="SyncPullRlsReadPathRules"/>'s source-text-scan style.
/// </summary>
public sealed class DistrictCodeInertRules
{
    private static readonly string[] InertRailIdentifiers =
    {
        "DistrictCode",
        "DialectRegion"
    };

    [Fact]
    public void Application_use_cases_never_reference_the_inert_geo_dialect_rails()
    {
        var solutionRoot = TestPathHelper.GetSolutionRoot();
        var useCasesRoot = Path.Combine(
            solutionRoot,
            "apps",
            "ShramSafal",
            "ShramSafal.Application",
            "UseCases");

        Directory.Exists(useCasesRoot).Should().BeTrue(
            $"the ShramSafal Application UseCases folder must exist at {useCasesRoot}");

        var sourceFiles = Directory.EnumerateFiles(
            useCasesRoot,
            "*.cs",
            SearchOption.AllDirectories);

        foreach (var file in sourceFiles)
        {
            var source = File.ReadAllText(file);

            foreach (var identifier in InertRailIdentifiers)
            {
                source.Should().NotContain(identifier,
                    $"{Path.GetFileName(file)} must not read or write the inert v1 rail " +
                    $"'{identifier}' — it stays NULL in v1 (ADR §3 / D3). A reference here " +
                    "means a v1 reader/writer crept in and the inert guarantee is broken.");
            }
        }
    }
}
