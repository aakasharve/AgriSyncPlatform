// spec: data-principle-spine-2026-05-05/03.5
using System.Text.RegularExpressions;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 03 sub-phase 03.5 — guard the admin
/// cross-tenant escape hatch contract:
///
/// <para>
/// Production code MUST NOT directly construct a
/// <c>ShramSafalDbContext</c> via
/// <c>new ShramSafalDbContext(new DbContextOptionsBuilder&lt;...&gt;().Options)</c>
/// outside the allowlisted factory files
/// (<c>ShramSafalDbContextFactory</c> design-time factory and
/// <c>ShramSafalAdminDbContextFactory</c> runtime admin factory). Every
/// other code path must resolve the context from DI so the
/// <see cref="AgriSync.BuildingBlocks.Persistence.TenantConnectionInterceptor"/>
/// is in the options chain and the per-request RLS claim flows
/// correctly.
/// </para>
///
/// <para>
/// <b>Scope.</b> Test runs over <c>src/apps/ShramSafal/**</c> +
/// <c>src/AgriSync.Bootstrapper/**</c>. Test files
/// (<c>src/tests/**</c>) and Migrations generated <c>.Designer.cs</c>
/// files are excluded because they legitimately construct the context
/// for testcontainer / EF-tooling purposes.
/// </para>
///
/// <para>
/// <b>How the check works.</b> Regex sweep over every <c>.cs</c> file
/// in scope looking for the literal substring
/// <c>new ShramSafalDbContext(</c>. Any hit outside the allowlist is a
/// violation. Naïve text matching is enough for this rule because the
/// alternative (Roslyn syntax-tree walk) is overkill for a single
/// constructor-call guardrail and would add a Microsoft.CodeAnalysis
/// dependency to the architecture-tests project for zero additional
/// signal.
/// </para>
/// </summary>
public sealed class AdminContextRules
{
    private static readonly string[] AllowlistedFileNames =
    {
        // Design-time EF tooling factory — runs `dotnet ef migrations …`.
        "ShramSafalDbContextFactory.cs",
        // 03.5 admin cross-tenant runtime factory.
        "ShramSafalAdminDbContextFactory.cs",
    };

    private static readonly Regex DirectCtorRegex = new(
        @"new\s+ShramSafalDbContext\s*\(",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    [Fact(DisplayName =
        "ShramSafalDbContext direct construction is restricted to factory allowlist")]
    public void ShramSafalDbContext_direct_construction_is_restricted_to_factory_allowlist()
    {
        var solutionRoot = TestPathHelper.GetSolutionRoot();

        // Scope to ShramSafal app + Bootstrapper. Tests + Migrations
        // legitimately construct the context for testcontainer / EF
        // tooling and are excluded.
        var roots = new[]
        {
            Path.Combine(solutionRoot, "apps", "ShramSafal"),
            Path.Combine(solutionRoot, "AgriSync.Bootstrapper"),
        };

        var violations = new List<string>();

        foreach (var root in roots)
        {
            if (!Directory.Exists(root))
            {
                continue;
            }

            foreach (var file in Directory.EnumerateFiles(root, "*.cs", SearchOption.AllDirectories))
            {
                var fileName = Path.GetFileName(file);

                // Skip allowlisted factory files.
                if (AllowlistedFileNames.Contains(fileName, StringComparer.OrdinalIgnoreCase))
                {
                    continue;
                }

                // Skip generated EF migration designers — they reference
                // the context type as a generic argument only, never call
                // `new ShramSafalDbContext(...)`, but the substring guard
                // is cheap and the generated files are noisy.
                if (fileName.EndsWith(".Designer.cs", StringComparison.OrdinalIgnoreCase) ||
                    fileName.EndsWith("ModelSnapshot.cs", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                // Skip bin/obj.
                var rel = Path.GetRelativePath(solutionRoot, file).Replace('\\', '/');
                if (rel.Contains("/bin/", StringComparison.OrdinalIgnoreCase) ||
                    rel.Contains("/obj/", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                var contents = File.ReadAllText(file);
                if (DirectCtorRegex.IsMatch(contents))
                {
                    violations.Add(rel);
                }
            }
        }

        Assert.True(
            violations.Count == 0,
            "ShramSafalDbContext must only be constructed via the allowlisted factories " +
            "(ShramSafalDbContextFactory for design-time tooling; " +
            "ShramSafalAdminDbContextFactory for runtime admin escape hatch). " +
            "Direct construction bypasses TenantConnectionInterceptor and would silently " +
            "leak cross-tenant rows once 03.3 RLS policies are in force. Violations:" +
            Environment.NewLine +
            string.Join(Environment.NewLine, violations));
    }
}
