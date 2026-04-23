using System.Text.RegularExpressions;
using FluentAssertions;
using ShramSafal.Domain.Organizations;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// W0-B CI gates for the admin auth pivot.
///
/// These tests are the safety net against four regressions the pivot is
/// vulnerable to:
///
///   G1  module-key drift:     ModuleKey.cs (C#) silently diverges from
///                             moduleKeys.ts (TypeScript). A missing key
///                             server-side → client sends a request that
///                             403s; extra key server-side → client doesn't
///                             know it can show a feature.
///
///   G2  admin-scope bypass:   someone reintroduces an IsAdmin(claim) helper
///                             or wires an /admin/ endpoint without routing
///                             through AdminScopeHelper. Both restore the
///                             pre-pivot claim-check footgun.
///
///   G3  redaction drop-out:   RedactionMatrix accidentally returns Full for
///                             a sensitive field across every (type, role)
///                             combo. Usually from removing a branch.
///
///   G4  CORS header drop:     X-Active-Org-Id disappears from the CORS
///                             allowlist in Program.cs → multi-org users
///                             silently fall back to a single-membership
///                             resolve.
///
/// Each failure message points at the concrete file and remediation step.
/// </summary>
public sealed class AdminAuthGateTests
{
    // ------------------------------------------------------------
    // G1 — module-key-drift-guard
    // ------------------------------------------------------------
    [Fact]
    public void ModuleKey_Cs_And_Ts_Sets_Are_Equal()
    {
        var csKeys = ModuleKey.All;

        var tsFile = FindRepoFile("src/clients/admin-web/src/lib/moduleKeys.ts");
        var tsContent = File.ReadAllText(tsFile);
        var tsKeys = ExtractTsStringLiterals(tsContent);

        tsKeys.Should().NotBeEmpty(
            "moduleKeys.ts should export a non-empty ModuleKeys object — the parser may have failed");

        var missingInTs = csKeys.Except(tsKeys).OrderBy(x => x).ToArray();
        var missingInCs = tsKeys.Except(csKeys).OrderBy(x => x).ToArray();

        (missingInTs.Length + missingInCs.Length).Should().Be(0,
            "ModuleKey.cs and moduleKeys.ts must stay in sync.\n" +
            $"  Keys in ModuleKey.cs NOT in moduleKeys.ts: {string.Join(", ", missingInTs)}\n" +
            $"  Keys in moduleKeys.ts NOT in ModuleKey.cs: {string.Join(", ", missingInCs)}\n" +
            "Remediation: add the missing key to the other file in the same commit.");
    }

    // ------------------------------------------------------------
    // G2 — admin-scope-guard
    // ------------------------------------------------------------
    [Fact]
    public void AdminEndpoints_Uses_AdminScopeHelper_And_No_IsAdmin_Helper_Remains()
    {
        AssertUsesResolverAndNoLegacyIsAdmin(
            "src/apps/ShramSafal/ShramSafal.Api/Endpoints/AdminEndpoints.cs");
    }

    [Fact]
    public void AiEndpoints_Uses_AdminScopeHelper_And_No_IsAdmin_Helper_Remains()
    {
        AssertUsesResolverAndNoLegacyIsAdmin(
            "src/apps/ShramSafal/ShramSafal.Api/Endpoints/AiEndpoints.cs");
    }

    private static void AssertUsesResolverAndNoLegacyIsAdmin(string relativePath)
    {
        var file = FindRepoFile(relativePath);
        var content = File.ReadAllText(file);

        content.Should().Contain("AdminScopeHelper",
            $"{relativePath} must route admin auth through AdminScopeHelper. " +
            "If you are adding a new admin endpoint, call ResolveOrDenyAsync (or " +
            "TryResolveSilentlyAsync for augmentation) before invoking the handler.");

        var legacyIsAdminCalls = Regex.Matches(content, @"\bIsAdmin\s*\(");
        legacyIsAdminCalls.Count.Should().Be(0,
            $"{relativePath} must not contain an IsAdmin(...) helper — the W0-B pivot " +
            "replaced it with AdminScopeHelper.ResolveOrDenyAsync. If you need admin " +
            "status for response augmentation, use AdminScopeHelper.TryResolveSilentlyAsync " +
            "and read scope?.IsPlatformAdmin.");
    }

    // ------------------------------------------------------------
    // G3 — redaction-matrix-coverage
    // ------------------------------------------------------------
    [Theory]
    [InlineData("ownerPhone")]
    [InlineData("workerName")]
    [InlineData("workerPhone")]
    [InlineData("payoutAmount")]
    [InlineData("farmGpsCoordinates")]
    [InlineData("deviationNote")]
    public void RedactionMatrix_RestrictsSensitiveField_ForAtLeastOne_OrgRolePair(string fieldName)
    {
        // A sensitive field must be restricted in at least one (orgType, orgRole)
        // combination. If every combo returns Full, the field is silently unmasked
        // for every non-Platform caller — which contradicts the W0-A spec §4.4c.
        var anyRestricted = false;
        foreach (var orgType in Enum.GetValues<OrganizationType>())
        {
            foreach (var orgRole in Enum.GetValues<OrganizationRole>())
            {
                // Sample module — the current RedactionMatrix impl keys on (type, role)
                // not module, so any module key surfaces the full matrix state.
                var policy = RedactionMatrix.For(orgType, orgRole, ModuleKey.CeiW4Labour);
                if (policy.For(fieldName) != FieldAccess.Full)
                {
                    anyRestricted = true;
                    break;
                }
            }
            if (anyRestricted) break;
        }

        anyRestricted.Should().BeTrue(
            $"Sensitive field '{fieldName}' should be Masked, Aggregated, or Hidden " +
            "for at least one (OrganizationType, OrganizationRole) combination. " +
            "Every branch currently returns Full — check RedactionMatrix.cs for a " +
            "removed rule or a missing dict assignment.");
    }

    // ------------------------------------------------------------
    // G4 — cors-preflight-guard
    // ------------------------------------------------------------
    [Fact]
    public void Program_CorsPolicy_Allows_X_Active_Org_Id_Header()
    {
        var program = FindRepoFile("src/AgriSync.Bootstrapper/Program.cs");
        var content = File.ReadAllText(program);

        content.Should().Contain("X-Active-Org-Id",
            "Program.cs CORS policy must list X-Active-Org-Id in its WithHeaders(...) call. " +
            "admin-web sends this header to select the active org on every request — " +
            "dropping it forces every multi-org user back to the Ambiguous path.");
    }

    // ------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------

    /// <summary>
    /// Walks up from the test binary's base directory until it finds a folder
    /// that contains the given relative path. Reliable across bin/Debug/netX/
    /// layouts and avoids hard-coded "../../../.."-style traversal.
    /// </summary>
    private static string FindRepoFile(string relativePath)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, relativePath);
            if (File.Exists(candidate)) return candidate;
            dir = dir.Parent;
        }
        throw new FileNotFoundException(
            $"Architecture gate could not locate '{relativePath}' walking up from {AppContext.BaseDirectory}.");
    }

    /// <summary>
    /// Extracts the string-literal values from moduleKeys.ts. Looks for the
    /// "key: 'value'" form inside the ModuleKeys object. Single or double
    /// quotes accepted.
    /// </summary>
    private static HashSet<string> ExtractTsStringLiterals(string content)
    {
        var regex = new Regex(
            @"^\s*[A-Za-z][A-Za-z0-9_]*\s*:\s*['""]([^'""]+)['""]\s*,?\s*$",
            RegexOptions.Multiline);
        var keys = new HashSet<string>(StringComparer.Ordinal);
        foreach (Match m in regex.Matches(content))
        {
            if (m.Groups.Count > 1) keys.Add(m.Groups[1].Value);
        }
        return keys;
    }
}
