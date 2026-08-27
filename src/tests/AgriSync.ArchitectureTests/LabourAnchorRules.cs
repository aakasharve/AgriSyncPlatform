using System.Text.RegularExpressions;
using FluentAssertions;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 3) — the
/// two structural pins the labour work rests on. Both are regex source scans in
/// the style of <c>RlsIdentityScopeRules</c> / <c>SyncPullRlsReadPathRules</c>;
/// this project uses no NetArchTest.
///
/// <list type="number">
/// <item><b>Single producer</b> — <c>LabourAssignment</c> is the canonical record
/// of a labour engagement. Task 6 adds a manual-entry producer alongside the
/// voice/AI derivation path. If two call sites construct it directly they will
/// drift, and the same real engagement gets stored two ways depending on how the
/// farmer entered it. So exactly one production file may call
/// <c>LabourAssignment.Create(</c>, and it must be the shared factory.</item>
/// <item><b>WTL v0 stays out of attribution (A8)</b> — the passive server-side
/// worker-reuse ledger (<c>WorkerAssignment</c> / <c>ssf.worker_assignments</c>)
/// must never be joined to field-operator work attribution.</item>
/// </list>
/// </summary>
public sealed class LabourAnchorRules
{
    /// <summary>
    /// The one production file permitted to construct a <c>LabourAssignment</c>.
    /// Src-relative, forward slashes (see <see cref="Relative"/>) —
    /// <c>TestPathHelper.GetSolutionRoot()</c> returns <c>&lt;repo&gt;/src</c>,
    /// not the repo root.
    /// </summary>
    private const string LabourAssignmentFactoryPath =
        "apps/ShramSafal/ShramSafal.Application/UseCases/Labour/LabourAssignmentFactory.cs";

    /// <summary>
    /// PIN 1 — one shared construction site for the canonical labour record.
    /// </summary>
    [Fact]
    public void LabourAssignment_is_constructed_in_exactly_one_production_file()
    {
        var producers = ProductionSourceFiles()
            .Where(path => StripComments(File.ReadAllText(path))
                .Contains("LabourAssignment.Create(", StringComparison.Ordinal))
            .Select(Relative)
            .OrderBy(path => path, StringComparer.Ordinal)
            .ToArray();

        producers.Should().ContainSingle(
            "LabourAssignment is the canonical record of a labour engagement — every producer " +
            "(voice derivation, manual entry) must go through LabourAssignmentFactory.FromParsed " +
            $"so the same engagement can never be stored two ways. Found: [{string.Join(", ", producers)}]");

        producers[0].Should().Be(LabourAssignmentFactoryPath,
            "the single construction site must be the shared factory, not whichever caller got there first");
    }

    /// <summary>
    /// PIN 2 — WTL v0 (the passive worker-reuse ledger) stays out of field-operator
    /// attribution (A8). No production file may reference both ledgers.
    ///
    /// <para><b>Exactly two files are excluded, by path suffix, deliberately.</b>
    /// The protected property is "the two ledgers are never JOINED as attribution",
    /// not "the two names never co-occur" — a <c>DbSet</c> declaration and an
    /// erasure manifest are declaration sites, not joins:</para>
    /// <list type="bullet">
    /// <item><c>ShramSafalDbContext.cs</c> — declares both <c>DbSet</c>s;
    /// declaration is not attribution.</item>
    /// <item><c>ErasureWorker.cs</c> — scrubs both ledgers; erasure is not
    /// attribution.</item>
    /// </list>
    /// <para><c>Migrations/</c> is already out of scope via
    /// <see cref="ProductionSourceFiles"/>.</para>
    ///
    /// <para><b>A third exclusion may NOT be added.</b> If a new file trips this
    /// pin, that is the pin working — widening it is a STOP-and-escalate, not a
    /// fix.</para>
    /// </summary>
    [Fact]
    public void Wtl_v0_worker_ledger_is_never_joined_to_field_operator_attribution()
    {
        // Matched on PATH SUFFIX, not bare filename — a bare-filename match would
        // silently exempt any future file anywhere that happened to share the name.
        var declarationOnlyPaths = new[]
        {
            "apps/ShramSafal/ShramSafal.Infrastructure/Persistence/ShramSafalDbContext.cs",
            "apps/ShramSafal/ShramSafal.Infrastructure/Privacy/ErasureWorker.cs",
        };

        var offenders = ProductionSourceFiles()
            .Where(path => !declarationOnlyPaths.Any(excluded =>
                Relative(path).EndsWith(excluded, StringComparison.OrdinalIgnoreCase)))
            .Where(path =>
            {
                var source = StripComments(File.ReadAllText(path));

                // First token is the IDENTITY, not just the work overlay:
                // FieldOperatorWorkRow contains "FieldOperator", so this is a strict
                // superset, and it also catches the likelier A8 violation — joining
                // the WTL ledger to the operator identity itself (e.g. seeding
                // operator names out of WorkerNameProjector). snake_case is included
                // on BOTH tokens because raw SQL is in this codebase's vocabulary.
                return (source.Contains("FieldOperator", StringComparison.Ordinal)
                        || source.Contains("field_operator", StringComparison.Ordinal))
                    && (source.Contains("WorkerAssignment", StringComparison.Ordinal)
                        || source.Contains("worker_assignments", StringComparison.Ordinal));
            })
            .Select(Relative)
            .OrderBy(path => path, StringComparer.Ordinal)
            .ToArray();

        offenders.Should().BeEmpty(
            "WTL v0's worker ledger is a passive server-side reuse index and is NEVER farmer-facing " +
            "attribution (A8). A file that names the field operator AND the WorkerAssignment ledger " +
            $"is joining the two. Offenders: [{string.Join(", ", offenders)}]");
    }

    // ── copied from RlsIdentityScopeRules (they are private static there;
    //    copy, do not import) ───────────────────────────────────────────────────

    private static IEnumerable<string> ProductionSourceFiles()
    {
        var srcRoot = TestPathHelper.GetSolutionRoot();

        return Directory
            .EnumerateFiles(srcRoot, "*.cs", SearchOption.AllDirectories)
            .Where(path =>
                // Tests may name whatever they like — proving the behaviour is
                // literally their job.
                !path.Contains($"{Path.DirectorySeparatorChar}tests{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase) &&
                // EF migrations + model snapshots are generated schema history.
                !path.Contains($"{Path.DirectorySeparatorChar}Migrations{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase) &&
                !path.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase) &&
                !path.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase));
    }

    private static string Relative(string fullPath) =>
        Path.GetRelativePath(TestPathHelper.GetSolutionRoot(), fullPath).Replace('\\', '/');

    /// <summary>
    /// Removes <c>//</c> line comments and <c>/* */</c> block comments so the
    /// rules match executable source only. This codebase documents its
    /// mechanisms heavily and on purpose; prose must never fail a build.
    /// </summary>
    private static string StripComments(string source)
    {
        var withoutBlockComments = Regex.Replace(source, @"/\*.*?\*/", string.Empty, RegexOptions.Singleline);
        return Regex.Replace(withoutBlockComments, @"^[^\S\r\n]*//.*$", string.Empty, RegexOptions.Multiline);
    }
}
