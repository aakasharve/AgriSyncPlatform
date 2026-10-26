// spec: plr-d7-m1-multiuser-2026-10-26 (step 1, SEC-5)
using System.Text.RegularExpressions;
using FluentAssertions;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 1, SEC-5) — <b>the relationship scope has exactly
/// one caller: self-exit.</b>
///
/// <para><c>ICallerFarmTenantScope.EstablishRelationshipForCallerAsync</c> publishes the farm's
/// tenant scope (<c>agrisync.farm_id</c> + <c>agrisync.owner_account_id</c>) to a caller whose seat
/// is merely "not ended" — a PendingApproval request typed with a farm code, a Suspended seat, a
/// PendingOtpClaim seat. With that scope every <c>p_tenant_*</c> policy on the farm's tables opens
/// for the rest of the request. It exists for ONE write: a person must always be able to withdraw
/// a pending request or leave a paused seat (<c>ExitMembershipHandler</c>), and that write needs the
/// scope the Active-only access gate (<c>EstablishForCallerAsync</c>) refuses them. Any second
/// caller — a read route, a handler that "just needs the scope" — would hand an unapproved person
/// the farm's data, the very thing BN-1 closed. Same for the repository read it rests on,
/// <c>GetFarmMembershipRelationshipForTenantAsync</c>: its only caller is that scope.</para>
///
/// <para><b>A source scan, honestly bounded.</b> It reads executable source (comments stripped) of
/// every production file and finds every mention of each method name — calls, method groups,
/// <c>nameof</c>. A mention is allowed only in the file that declares the method, the file that
/// implements it, and its one sanctioned caller, and the caller may mention it once. A wrapper that
/// re-exposes the scope under another name would itself have to mention the method, in a file that
/// is not on the list — so it is caught too. Reflection or a string-built name is not caught; that
/// is review's job.</para>
/// </summary>
public sealed class RelationshipScopeCallerRules
{
    [Fact]
    public void Only_self_exit_establishes_the_relationship_scope()
    {
        AssertOnlySanctionedMentions(
            methodName: "EstablishRelationshipForCallerAsync",
            declaringFiles: new[]
            {
                "apps/ShramSafal/ShramSafal.Application/Ports/ICallerFarmTenantScope.cs",
                "apps/ShramSafal/ShramSafal.Infrastructure/Auth/CallerFarmTenantScope.cs",
            },
            soleCallerFile: "apps/ShramSafal/ShramSafal.Application/UseCases/Memberships/ExitMembership/ExitMembershipHandler.cs");
    }

    [Fact]
    public void Only_the_relationship_scope_reads_the_relationship_membership()
    {
        AssertOnlySanctionedMentions(
            methodName: "GetFarmMembershipRelationshipForTenantAsync",
            declaringFiles: new[]
            {
                "apps/ShramSafal/ShramSafal.Application/Ports/IShramSafalRepository.cs",
                "apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Repositories/ShramSafalRepository.cs",
            },
            soleCallerFile: "apps/ShramSafal/ShramSafal.Infrastructure/Auth/CallerFarmTenantScope.cs");
    }

    /// <summary>
    /// The relationship scope's implementation must stay a relationship-ONLY branch of the shared
    /// gate: the access scope (<c>EstablishForCallerAsync</c>) must never route through the
    /// relationship read. Pins the two one-line bodies by their flag.
    /// </summary>
    [Fact]
    public void The_access_scope_never_takes_the_relationship_branch()
    {
        var source = StripComments(ReadSource("apps/ShramSafal/ShramSafal.Infrastructure/Auth/CallerFarmTenantScope.cs"));

        Regex.IsMatch(source,
                @"EstablishForCallerAsync\([^)]*\)\s*=>\s*EstablishAsync\([^)]*relationshipOnly:\s*false")
            .Should().BeTrue("the Active-only access gate must call the shared body with relationshipOnly: false");
        Regex.IsMatch(source,
                @"EstablishRelationshipForCallerAsync\([^)]*\)\s*=>\s*EstablishAsync\([^)]*relationshipOnly:\s*true")
            .Should().BeTrue("control: the relationship scope is the only body that passes relationshipOnly: true");
        Regex.Matches(source, @"relationshipOnly:\s*true").Count
            .Should().Be(1, "exactly one entry point may open the relationship branch");
    }

    private static void AssertOnlySanctionedMentions(string methodName, string[] declaringFiles, string soleCallerFile)
    {
        var mention = new Regex($@"\b{Regex.Escape(methodName)}\b", RegexOptions.Compiled);

        var mentionsByFile = ProductionSourceFiles()
            .Select(file => (File: Relative(file), Count: mention.Matches(StripComments(File.ReadAllText(file))).Count))
            .Where(x => x.Count > 0)
            .ToDictionary(x => x.File, x => x.Count, StringComparer.OrdinalIgnoreCase);

        // Vacuity guard: the scan must actually see the sanctioned caller and the declarations,
        // or a moved file / drifted name would pass by matching nothing.
        mentionsByFile.Should().ContainKey(soleCallerFile,
            $"the sanctioned caller must still call {methodName} — if it moved, update this rule deliberately");
        foreach (var declaring in declaringFiles)
        {
            mentionsByFile.Should().ContainKey(declaring, $"{methodName} must still be declared/implemented in {declaring}");
        }

        mentionsByFile[soleCallerFile].Should().Be(1,
            $"{soleCallerFile} is the one sanctioned use of {methodName}, once");

        var allowed = declaringFiles.Append(soleCallerFile).ToHashSet(StringComparer.OrdinalIgnoreCase);
        mentionsByFile.Keys.Where(file => !allowed.Contains(file)).Should().BeEmpty(
            $"{methodName} opens a farm's tenant scope to a person who has NOT been let in (a pending " +
            "request, a paused seat). Its only legitimate use is letting that person leave " +
            "(ExitMembershipHandler). Use ICallerFarmTenantScope.EstablishForCallerAsync (Active seats " +
            "and the owner only) for anything else. If a genuinely new caller is needed, change this " +
            "rule deliberately, in review (spec plr-d7-m1-multiuser-2026-10-26 SEC-5)");
    }

    private static string ReadSource(string relativePath)
    {
        var fullPath = Path.Combine(TestPathHelper.GetSolutionRoot(), relativePath.Replace('/', Path.DirectorySeparatorChar));
        File.Exists(fullPath).Should().BeTrue($"{relativePath} must exist for this rule to mean anything");
        return File.ReadAllText(fullPath);
    }

    private static IEnumerable<string> ProductionSourceFiles()
    {
        var srcRoot = TestPathHelper.GetSolutionRoot();
        var sep = Path.DirectorySeparatorChar;

        return Directory
            .EnumerateFiles(srcRoot, "*.cs", SearchOption.AllDirectories)
            .Where(path =>
                !path.Contains($"{sep}tests{sep}", StringComparison.OrdinalIgnoreCase) &&
                !path.Contains($"{sep}obj{sep}", StringComparison.OrdinalIgnoreCase) &&
                !path.Contains($"{sep}bin{sep}", StringComparison.OrdinalIgnoreCase) &&
                !path.Contains($"{sep}node_modules{sep}", StringComparison.OrdinalIgnoreCase));
    }

    private static string Relative(string fullPath) =>
        Path.GetRelativePath(TestPathHelper.GetSolutionRoot(), fullPath).Replace('\\', '/');

    /// <summary>Removes <c>/* */</c> block comments and whole-line <c>//</c> / <c>///</c> comments
    /// (the same stripping as <see cref="RlsIdentityScopeRules"/>), so prose naming the method —
    /// there is a lot of it, deliberately — never counts as a use.</summary>
    private static string StripComments(string source)
    {
        var withoutBlockComments = Regex.Replace(source, @"/\*.*?\*/", string.Empty, RegexOptions.Singleline);
        return Regex.Replace(withoutBlockComments, @"^[^\S\r\n]*//.*$", string.Empty, RegexOptions.Multiline);
    }
}
