// spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN §P0.3
using System.Text.RegularExpressions;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// §P0.3 — <b>every <c>/farms/{farmId:guid}/…</c> route must establish tenant
/// scope before it touches the database.</b>
///
/// <para><b>Why this test exists.</b> <c>PUT /shramsafal/farms/{farmId}/boundary</c>
/// spent months returning <b>500 to every farmer</b> — measured, not inferred —
/// because commit <c>69262b9f</c> wired <c>ICallerFarmTenantScope</c> into the
/// three farm READ routes and missed the one WRITE route. Since FORCE-RLS
/// landed on <c>ssf.farms</c>, an unscoped farm-keyed route dies at
/// <c>TenantConnectionInterceptor</c>'s fail-closed throw on its FIRST
/// DbCommand. Nothing in the test suite noticed, because the defect lives in
/// the wiring between an endpoint and the DI container and no test exercised
/// that route end-to-end. This file is the cheap guard that would have.</para>
///
/// <para><b>Why a source scan.</b> Same mechanism as
/// <see cref="RlsExemptionAllowlistTests"/>: the property under test is a
/// property of the SOURCE (does this lambda ask for the scope?), and a source
/// scan catches a deleted parameter in milliseconds without a database, a
/// server or a JWT. The runtime proof lives in
/// <c>FarmBoundaryRlsRealPostgresTests</c> and in the §P0.3 execution record;
/// this is the regression tripwire, not the proof.</para>
///
/// <para>🛑 <b>The skip-list is NOT an acceptable way to satisfy this test.</b>
/// Adding <c>/shramsafal/farms</c> to
/// <c>TenantTransactionMiddleware.SkipPathPrefixes</c> would make the route
/// stop 500ing while setting <b>no tenant GUC at all</b> — every farm-scoped
/// policy would then filter to nothing, and
/// <c>UpdateFarmBoundaryHandler</c>'s <c>?? 0</c> / <c>?.Archive</c> would
/// silently reset the boundary version and skip the archive. The second
/// [Fact] asserts that prefix is absent.</para>
/// </summary>
public sealed class FarmScopedRouteTenantScopeTests
{
    /// <summary>
    /// Endpoint files whose <c>/farms/{farmId:guid}</c> routes are farm-scoped
    /// and therefore must establish scope. Kept explicit rather than globbed so
    /// adding a new endpoint file is a deliberate decision, not an accident.
    /// </summary>
    private static readonly string[] FarmScopedEndpointFiles =
    {
        Path.Combine("ShramSafal", "ShramSafal.Api", "Endpoints", "FarmEndpoints.cs"),
    };

    [Fact]
    public void Every_farm_id_route_establishes_the_caller_farm_tenant_scope()
    {
        var appsRoot = TestPathHelper.GetAppsRoot();

        // A route registration: group.MapGet/MapPut/MapPost("…/farms/{farmId:guid}…",
        // followed by its lambda body up to the next `group.Map` (or EOF).
        var routePattern = new Regex(
            "group\\.Map(?<verb>Get|Put|Post|Patch|Delete)\\(\\s*\"(?<route>[^\"]*/farms/\\{farmId:guid\\}[^\"]*)\"",
            RegexOptions.Compiled);

        var unscoped = new List<string>();
        var checkedRoutes = 0;

        foreach (var relative in FarmScopedEndpointFiles)
        {
            var path = Path.Combine(appsRoot, relative);
            Assert.True(File.Exists(path), $"Endpoint file not found at {path}.");

            var text = File.ReadAllText(path);
            var matches = routePattern.Matches(text);
            Assert.True(
                matches.Count > 0,
                $"No /farms/{{farmId:guid}} routes found in {relative}. Either the routes moved or the "
                    + "regex drifted — a scan that matches nothing passes vacuously, which is exactly the "
                    + "failure mode this test exists to prevent.");

            foreach (Match match in matches)
            {
                checkedRoutes++;

                // The lambda body runs from this registration to the start of
                // the next one (registrations are siblings in MapFarmEndpoints).
                var start = match.Index;
                var nextIndex = text.IndexOf("group.Map", start + match.Length, StringComparison.Ordinal);
                var body = nextIndex < 0 ? text[start..] : text[start..nextIndex];

                if (!body.Contains("EstablishForCallerAsync", StringComparison.Ordinal))
                {
                    unscoped.Add($"{relative}: {match.Groups["verb"].Value} {match.Groups["route"].Value}");
                }
            }
        }

        Assert.True(
            unscoped.Count == 0,
            "The following farm-keyed routes never call ICallerFarmTenantScope.EstablishForCallerAsync, "
                + "so they will throw 'no tenant claim set and not in admin scope' on their FIRST DbCommand "
                + "and return 500 to every farmer: "
                + string.Join(", ", unscoped)
                + ". Inject ShramSafal.Application.Ports.ICallerFarmTenantScope and await "
                + "EstablishForCallerAsync(farmId, actorUserId, ct) before building the command — mirror the "
                + "GET /farms/{farmId:guid} route. Do NOT 'fix' this by adding the path to "
                + "TenantTransactionMiddleware.SkipPathPrefixes.");

        Assert.True(checkedRoutes >= 4, $"Expected at least 4 farm-keyed routes, scanned {checkedRoutes}.");
    }

    [Fact]
    public void The_farm_scoped_route_prefix_is_not_on_the_tenant_transaction_skip_list()
    {
        var solutionRoot = TestPathHelper.GetSolutionRoot();
        var path = Path.Combine(
            solutionRoot, "AgriSync.BuildingBlocks", "Persistence", "TenantTransactionMiddleware.cs");
        Assert.True(File.Exists(path), $"TenantTransactionMiddleware not found at {path}.");

        var text = File.ReadAllText(path);
        var skipListStart = text.IndexOf("SkipPathPrefixes", StringComparison.Ordinal);
        Assert.True(skipListStart >= 0, "SkipPathPrefixes array not found — the regex or the file drifted.");

        var skipListEnd = text.IndexOf("};", skipListStart, StringComparison.Ordinal);
        Assert.True(skipListEnd > skipListStart, "Could not delimit the SkipPathPrefixes initializer.");
        var skipList = text[skipListStart..skipListEnd];

        // "/shramsafal/farms/mine" is a DELIBERATE, narrower entry (a pre-farm-
        // selection bootstrap route that spans all the caller's farms). The
        // forbidden thing is the broad prefix that would swallow every
        // /shramsafal/farms/{farmId}/… route with it.
        var withoutMine = skipList.Replace("\"/shramsafal/farms/mine\"", string.Empty, StringComparison.Ordinal);

        Assert.False(
            withoutMine.Contains("\"/shramsafal/farms\"", StringComparison.Ordinal),
            "\"/shramsafal/farms\" must NOT be on TenantTransactionMiddleware.SkipPathPrefixes. It would "
                + "admin-elevate every farm-keyed route, which makes TenantConnectionInterceptor a no-op that "
                + "sets NO tenant GUC — every farm-scoped RLS policy would then filter to nothing. For "
                + "UpdateFarmBoundaryHandler specifically that is silent data loss, not an error: the "
                + "prior-boundary read returns null, `?? 0` recomputes version 1 and `?.Archive` does nothing. "
                + "Establish scope with ICallerFarmTenantScope instead.");
    }
}
