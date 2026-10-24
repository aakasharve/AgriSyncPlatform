using System.Text.RegularExpressions;
using FluentAssertions;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// R1 Task 2.4 (final direction §7, narrowed by the 2026-09-01 plan) — the
/// हजेरी ledger must not lose an entitled reader because capture state is
/// missing, so NO ledger/labour read path may take the labour WRITE-authority
/// gate as an authorisation input.
///
/// <para>Regex source scan in the <c>LabourAnchorRules</c> style; no
/// NetArchTest. This pin neither adds nor removes the access check the read
/// path performs today (caller is the declared owner OR holds a non-terminal
/// membership — pre-existing, repo-wide, out of Labour V2's scope to redesign).
/// It only stops a future executor wiring capture/write authority into the
/// read while building Phase 2+.</para>
///
/// <para><b><c>HasExplicitGrantAsync</c> is deliberately NOT banned:</b>
/// <c>GetLabourDataHandler</c> feeds it to the verification FSM to compute
/// which next-actions to render — an FSM input, not a read gate.</para>
/// </summary>
public sealed class LabourLedgerReadRules
{
    private const string WriteAuthorityToken = "LabourManagementGate.IsAllowedAsync(";

    private const string ShippedLedgerRead =
        "apps/ShramSafal/ShramSafal.Application/UseCases/Labour/GetLabourData/GetLabourDataHandler.cs";

    [Fact]
    public void Ledger_and_labour_reads_never_consult_the_write_authority_gate()
    {
        // Read-path candidates: every production Get*Handler under
        // UseCases/Labour, plus any production file that builds or names the
        // ledger. Matched on the src-relative path, forward slashes.
        var candidates = ProductionSourceFiles()
            .Where(path =>
            {
                var relative = Relative(path);
                var fileName = Path.GetFileName(relative);

                var isLabourReadHandler =
                    relative.Contains("/UseCases/Labour/", StringComparison.Ordinal)
                    && fileName.StartsWith("Get", StringComparison.Ordinal)
                    && fileName.EndsWith("Handler.cs", StringComparison.Ordinal);

                var namesTheLedger =
                    fileName.Contains("Ledger", StringComparison.Ordinal)
                    || StripComments(File.ReadAllText(path))
                        .Contains("BuildHajeriLedger", StringComparison.Ordinal);

                return isLabourReadHandler || namesTheLedger;
            })
            .ToArray();

        // Vacuity guard: the one shipped ledger read must be inside the scan,
        // or this pin pins nothing.
        candidates.Select(Relative).Should().Contain(ShippedLedgerRead,
            "if GetLabourDataHandler moved, update ShippedLedgerRead — never delete this guard");

        var offenders = candidates
            .Where(path => StripComments(File.ReadAllText(path))
                .Contains(WriteAuthorityToken, StringComparison.Ordinal))
            .Select(Relative)
            .OrderBy(p => p, StringComparer.Ordinal)
            .ToArray();

        offenders.Should().BeEmpty(
            "IsAllowedAsync answers 'may this caller REWRITE labour truth'. A ledger read asking it "
            + "would make the register vanish for a member whose capture authority is off — the exact "
            + "gating final direction §7 forbids. The read path's own access check stays as it is. "
            + $"Offenders: [{string.Join(", ", offenders)}]");
    }

    // ── copied from LabourAnchorRules (private static there; copy, do not import) ──

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
