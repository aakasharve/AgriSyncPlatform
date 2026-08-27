using System.Text.RegularExpressions;
using FluentAssertions;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// spec: rls-identity-sweep-2026-08-10 — regression guard for the
/// "queried an RLS-protected table without establishing who is asking" bug
/// class.
///
/// <para>
/// <b>Honest statement of what these rules can and cannot do.</b> There is NO
/// reliable static rule for "this code path reads a FORCE-RLS table without an
/// identity". Identity can legitimately be established three or four frames up
/// the stack — in <c>TenantTransactionMiddleware</c>, in
/// <c>ICallerFarmTenantScope</c> at the endpoint, in a repository method's own
/// transaction, or by the caller of a caller — and whether a given LINQ
/// expression touches a protected table is a runtime fact about the EF model and
/// the live <c>pg_policies</c> catalogue, not a syntactic one. A test claiming to
/// check that would be theatre.
/// </para>
///
/// <para>
/// So these three rules assert only things that are actually decidable from the
/// source, and each targets a failure mode that has REALLY happened here:
/// <list type="number">
/// <item><b>GUC vocabulary containment</b> — the tenant GUCs may only be written
/// by a closed, reviewed set of files. This is what forces new call sites through
/// the shared <c>RlsIdentityScope</c> helper instead of growing a sixth private
/// copy of the technique.</item>
/// <item><b>The discarded-privileged-context anti-pattern</b> — a file that opens
/// an admin <c>DbContext</c> and immediately throws it away must establish a real
/// identity somewhere. This is EXACTLY the shape of the
/// <c>ComplianceEvaluatorSweeper</c> / <c>TestOverdueSweeper</c> /
/// <c>WorkerRetentionJob</c> bug: open privileged context, discard it, call
/// <c>ElevateToAdminCrossTenant()</c> (which grants NO visibility), then query the
/// RLS-bound scoped context and silently get zero rows forever.</item>
/// <item><b>Pins on the sites fixed in this sweep</b> — the same shape must not
/// quietly regress, in the style of the existing
/// <c>SyncPullRlsReadPathRules</c>.</item>
/// </list>
/// </para>
///
/// <para>
/// What is still NOT covered, and is therefore a review responsibility: a
/// BRAND-NEW call site that forgets identity entirely. On a normal request path
/// that fails LOUDLY (<c>TenantConnectionInterceptor</c> throws "no tenant claim
/// set and not in admin scope" → HTTP 500). On an admin-elevated route or in a
/// background job it fails SILENTLY with zero rows — those two contexts are where
/// every instance of this bug has been found, and they need integration tests
/// against a real RLS-enabled Postgres, not a source scan.
/// </para>
/// </summary>
public sealed class RlsIdentityScopeRules
{
    /// <summary>
    /// Writes a tenant GUC as executable SQL — <c>set_config('agrisync.…')</c> or
    /// <c>SET LOCAL agrisync.…</c>. Comment lines are stripped before matching so
    /// documentation naming the GUCs (there is a lot of it, deliberately) does not
    /// trip the rule.
    /// </summary>
    private static readonly Regex GucWriteSql = new(
        @"set_config\(\s*'agrisync\.|SET\s+LOCAL\s+agrisync\.",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// <summary>
    /// The ONLY production files permitted to write a tenant GUC directly. Each
    /// entry is a reviewed mechanism, not a convenience:
    /// <list type="bullet">
    /// <item><c>RlsIdentityScope</c> — the shared helper every NEW call site must
    /// use.</item>
    /// <item><c>TenantConnectionInterceptor</c> — the per-command prelude for the
    /// normal request pipeline.</item>
    /// <item><c>CallerFarmTenantScope</c> — the prod-proven HTTP farm-scope gate.
    /// Not folded into the helper because its step 3b all-zeros
    /// <c>agrisync.farm_id</c> sentinel is load-bearing ordering (it neutralises a
    /// legacy bare-cast policy BEFORE the membership read) and rewriting it is a
    /// security-review-sized change, not a refactor.</item>
    /// <item><c>PushSyncBatchHandler</c> — the <c>/sync/push</c> two-phase
    /// "discover the farm from a child entity, then scope to it" mechanism.</item>
    /// <item><c>FirstFarmBootstrapEndpoints</c> — the first-farm write path.</item>
    /// </list>
    /// Adding a file here is a deliberate act that shows up in review. That is the
    /// point.
    /// </summary>
    private static readonly string[] GucWriteAllowlist =
    {
        Path.Combine("AgriSync.BuildingBlocks", "Persistence", "RlsIdentityScope.cs"),
        Path.Combine("AgriSync.BuildingBlocks", "Persistence", "TenantConnectionInterceptor.cs"),
        Path.Combine("ShramSafal.Infrastructure", "Auth", "CallerFarmTenantScope.cs"),
        Path.Combine("PushSyncBatch", "PushSyncBatchHandler.cs"),
        Path.Combine("AgriSync.Bootstrapper", "Endpoints", "FirstFarmBootstrapEndpoints.cs"),
    };

    [Fact]
    public void Tenant_gucs_are_only_written_by_the_sanctioned_mechanisms()
    {
        var offenders = new List<string>();

        foreach (var file in ProductionSourceFiles())
        {
            if (GucWriteAllowlist.Any(allowed => file.EndsWith(allowed, StringComparison.OrdinalIgnoreCase)))
            {
                continue;
            }

            var executableSource = StripComments(File.ReadAllText(file));
            if (GucWriteSql.IsMatch(executableSource))
            {
                offenders.Add(Relative(file));
            }
        }

        offenders.Should().BeEmpty(
            "a tenant GUC written outside the reviewed mechanisms is how this bug class spreads — " +
            "every private copy of `set_config('agrisync.…')` is one more place that can forget the " +
            "transaction, forget the NULLIF-safe empty case, or drift from the others. Use " +
            "AgriSync.BuildingBlocks.Persistence.RlsIdentityScope (RunAsUserAsync / RunAsFarmAsync). " +
            "If a genuinely new mechanism is required, add it to GucWriteAllowlist in this test with " +
            "a comment saying why — deliberately, in review");
    }

    [Fact]
    public void Discarding_a_privileged_context_requires_establishing_a_real_identity()
    {
        // The anti-pattern, verbatim from the bug:
        //
        //     await using (await adminFactory.CreateAsync(...)) { /* audit only */ }
        //     scope.ServiceProvider.GetRequiredService<TenantContext>()
        //          .ElevateToAdminCrossTenant();
        //     var repository = scope.ServiceProvider.GetRequiredService<IShramSafalRepository>();
        //     farmIds = await repository.GetAllActiveFarmIdsAsync(ct);   // ← always 0 rows
        //
        // ElevateToAdminCrossTenant only tells the interceptor to skip its GUC
        // prelude. It grants NO visibility: the app connects as agrisync_app,
        // which owns nothing and has no BYPASSRLS, so the FORCE-RLS policies see
        // NULL and filter every row away. Silently. Forever.
        var discardedAdminContext = new Regex(
            @"await\s+using\s*\(\s*await\s+[A-Za-z_][\w\.]*CreateAsync\([^;]*?\)\s*\)\s*\{(?<body>[^{}]*)\}",
            RegexOptions.Compiled | RegexOptions.Singleline);

        var offenders = new List<string>();

        foreach (var file in ProductionSourceFiles())
        {
            var source = File.ReadAllText(file);
            var executableSource = StripComments(source);

            var hasDiscardedContext = discardedAdminContext
                .Matches(executableSource)
                .Any(m => string.IsNullOrWhiteSpace(m.Groups["body"].Value));

            if (!hasDiscardedContext)
            {
                continue;
            }

            // An identity is: the shared helper, or a single-tenant TenantContext
            // claim. ElevateToAdminCrossTenant() deliberately does NOT count —
            // treating it as identity is the bug.
            var establishesIdentity =
                executableSource.Contains("RlsIdentityScope.RunAs", StringComparison.Ordinal) ||
                executableSource.Contains(".SetTenant(", StringComparison.Ordinal) ||
                executableSource.Contains(".SetUserScoped(", StringComparison.Ordinal);

            if (!establishesIdentity)
            {
                offenders.Add(Relative(file));
            }
        }

        offenders.Should().BeEmpty(
            "these files open a privileged DbContext, throw it away, and then keep working through " +
            "the RLS-bound scoped context with no identity established. ElevateToAdminCrossTenant() " +
            "is not an identity — it only silences TenantConnectionInterceptor's fail-closed guard, " +
            "and the FORCE-RLS policies then return ZERO rows with no error. Either run the " +
            "cross-tenant query ON the privileged context the factory handed back, or establish a " +
            "real scope with RlsIdentityScope.RunAsFarmAsync / RunAsUserAsync");
    }

    /// <summary>
    /// Pins the call sites repaired by the 2026-08-10 sweep. Each pin names the
    /// symptom the founder actually saw, so a future reader deleting the line
    /// knows what they are re-breaking.
    /// </summary>
    [Theory]
    // Bug 4 — the login JWT lost its `membership` claim because the AutoInclude'd
    // public.memberships join ran with no agrisync.user_id, which made
    // POST /shramsafal/compliance/evaluate/{farmId} answer 403 to the farm's own
    // PrimaryOwner.
    [InlineData("apps/User/User.Infrastructure/Persistence/Repositories/UserRepository.cs",
        "RlsIdentityScope.RunAsUserAsync")]
    // Bug 5 — the nightly sweeper enumerated farms through the RLS-bound scoped
    // repository and logged "no active farms found" on every pass since it shipped.
    [InlineData("AgriSync.Bootstrapper/Jobs/ComplianceEvaluatorSweeper.cs",
        "RlsIdentityScope.RunAsFarmAsync")]
    [InlineData("AgriSync.Bootstrapper/Jobs/ComplianceEvaluatorSweeper.cs",
        "adminDb.FarmMemberships")]
    // Same shape — "no instances to transition" on every pass.
    [InlineData("AgriSync.Bootstrapper/Jobs/TestOverdueSweeper.cs",
        "RlsIdentityScope.RunAsFarmAsync")]
    [InlineData("AgriSync.Bootstrapper/Jobs/TestOverdueSweeper.cs",
        "adminDb.TestInstances")]
    // Same shape — no WorkerRetained30d growth event had ever been emitted.
    [InlineData("AgriSync.Bootstrapper/Infrastructure/WorkerRetentionReader.cs",
        "IAdminDbContextFactory<ShramSafalDbContext>")]
    // /user/auth/me/context answered `farms: []` for a farmer who owns a farm.
    [InlineData("AgriSync.Bootstrapper/Adapters/MeContextAdapters.cs",
        "RlsIdentityScope.RunAsUserAsync")]
    // GET /shramsafal/farms/mine — the original one-off, now on the shared helper.
    [InlineData("apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Repositories/ShramSafalRepository.cs",
        "RlsIdentityScope.RunAsUserAsync")]
    // POST /shramsafal/compliance/evaluate/{farmId} + GET /farms/{farmId}/compliance
    // both fail-closed 500'd with no farm scope.
    [InlineData("apps/ShramSafal/ShramSafal.Api/Endpoints/ComplianceEndpoints.cs",
        "scope.EstablishForCallerAsync")]
    public void Repaired_call_sites_keep_establishing_identity(string relativePath, string requiredMarker)
    {
        var fullPath = Path.Combine(TestPathHelper.GetSolutionRoot(), relativePath.Replace('/', Path.DirectorySeparatorChar));

        File.Exists(fullPath).Should().BeTrue($"{relativePath} must exist for this rule to mean anything");

        File.ReadAllText(fullPath).Should().Contain(requiredMarker,
            $"{relativePath} reads a FORCE-RLS table from outside the normal request pipeline. " +
            "Removing this marker puts the silent-zero-rows bug back");
    }

    /// <summary>
    /// GET /shramsafal/attachments (+ /{id}, /{id}/download) read ssf.attachments,
    /// which is RLS ENABLED and FORCED, from a prefix that is admin-elevated for
    /// the sake of its POST writes. Without the verb-scoped user-scoped entry the
    /// list returns `[]` and metadata/download return 404 for rows that exist on
    /// the caller's own farm.
    /// </summary>
    [Fact]
    public void Attachment_reads_stay_user_scoped_while_attachment_writes_stay_admin_elevated()
    {
        var middleware = File.ReadAllText(Path.Combine(
            TestPathHelper.GetSolutionRoot(),
            "AgriSync.BuildingBlocks", "Persistence", "TenantTransactionMiddleware.cs"));

        middleware.Should().Contain(@"new(""GET"", ""/shramsafal/attachments"")",
            "the attachment READS must enter user-scoped mode so the p_user_select_attachments " +
            "policy can surface the caller's own rows");
        middleware.Should().Contain(@"""/shramsafal/attachments"",",
            "the attachment WRITES (POST create + upload) must stay on the admin skip-list — " +
            "user-scoped mode is read-only and sets no agrisync.farm_id for their WITH CHECK");
    }

    private static IEnumerable<string> ProductionSourceFiles()
    {
        var srcRoot = TestPathHelper.GetSolutionRoot();

        return Directory
            .EnumerateFiles(srcRoot, "*.cs", SearchOption.AllDirectories)
            .Where(path =>
                // Tests may hand-roll GUCs freely — proving RLS behaviour is
                // literally their job (see ShramSafal.Sync.IntegrationTests/Tenancy).
                !path.Contains($"{Path.DirectorySeparatorChar}tests{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase) &&
                // EF migrations ARE the policy definitions; they must name the GUCs.
                !path.Contains($"{Path.DirectorySeparatorChar}Migrations{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase) &&
                !path.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase) &&
                !path.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase));
    }

    private static string Relative(string fullPath) =>
        Path.GetRelativePath(TestPathHelper.GetSolutionRoot(), fullPath).Replace('\\', '/');

    /// <summary>
    /// Removes <c>//</c> line comments and <c>/* */</c> block comments so the
    /// rules match executable source only. This codebase documents the GUC
    /// mechanism heavily and on purpose; prose must never fail a build.
    /// </summary>
    private static string StripComments(string source)
    {
        var withoutBlockComments = Regex.Replace(source, @"/\*.*?\*/", string.Empty, RegexOptions.Singleline);
        return Regex.Replace(withoutBlockComments, @"^[^\S\r\n]*//.*$", string.Empty, RegexOptions.Multiline);
    }
}
