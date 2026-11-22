// spec: plr-d10 SEC-1 server fixes (D-184), findings F13 (CORS methods) and F14 (Production origins)
using System.Text.RegularExpressions;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// SEC-1 F13 + F14 - the server's CORS policy (<c>AllowFrontend</c> in <c>Program.cs</c>), the sibling of
/// <see cref="FrontendCorsHeaderRules"/> (which checks the request headers).
///
/// <para><b>F13 - methods.</b> A browser or Android WebView refuses a cross-origin <c>PATCH</c> in preflight unless the
/// policy lists it. The server already serves a <c>PATCH</c> route (<c>MapPatch</c> in <c>LabourEndpoints</c>), so the day a
/// screen calls it the request would be blocked before it reached the server. The policy must list <c>PATCH</c>, and - so the
/// same hole cannot open for the next verb - every verb any server route is mapped with.</para>
///
/// <para><b>F14 - origins.</b> The configuration the Production host really reads is <c>appsettings.json</c> overlaid with
/// <c>appsettings.Production.json</c>. Arrays merge BY INDEX, so a Production list shorter than the base list lets the
/// leftover base entries (the developer's <c>http://localhost:5173</c>, a plain <c>http://localhost</c>) leak back in. The
/// merged Production list must be exactly the five origins the apps are served from, with no plain-http origin at all: the
/// Android app runs on <c>https://localhost</c>, so an allowed <c>http://localhost</c> only lets any page served over plain
/// http on a visitor's own machine call the API.</para>
///
/// <para>Written from the SEC-1 test spec (F13, F14) and the two configuration files; Program.cs is read only for the policy's
/// own method list, the same way <see cref="FrontendCorsHeaderRules"/> reads its header list.</para>
/// </summary>
public sealed class FrontendCorsMethodAndOriginRules
{
    private static readonly string[] ProductionOrigins =
    [
        "https://app.shramsafal.in",
        "https://shramsafal.in",
        "https://admin.shramsafal.in",
        "capacitor://localhost",
        "https://localhost",
    ];

    // ── F13 ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void The_cors_policy_allows_PATCH()
    {
        AllowedMethods().Should().Contain("PATCH",
            "LabourEndpoints serves PATCH field-operators/{id}; a browser or WebView refuses a PATCH in preflight unless the policy lists it");
    }

    [Fact]
    public void The_cors_policy_keeps_every_method_it_already_allowed()
    {
        AllowedMethods().Should().Contain(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
    }

    [Fact]
    public void Every_http_method_a_server_route_is_mapped_with_is_allowed_by_the_cors_policy()
    {
        var allowed = AllowedMethods();
        var verb = new Regex(@"\.Map(Get|Post|Put|Patch|Delete)\s*\(", RegexOptions.Compiled);

        var used = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in ProductionSourceFiles())
        {
            foreach (Match m in verb.Matches(File.ReadAllText(file)))
            {
                used.TryAdd(m.Groups[1].Value.ToUpperInvariant(), Relative(file));
            }
        }

        // Vacuity guard: the scan must actually see the routes, or it would pass by matching nothing.
        used.Should().ContainKey("GET").And.ContainKey("POST", "the server maps GET and POST routes");
        used.Should().ContainKey("PATCH", "LabourEndpoints maps a PATCH route; if it moved, update this rule deliberately");

        var blocked = used.Where(kv => !allowed.Contains(kv.Key)).Select(kv => $"{kv.Key} (mapped in {kv.Value})").ToList();
        blocked.Should().BeEmpty(
            "a browser or WebView refuses a cross-origin request whose method the CORS policy (Program.cs, AllowFrontend "
            + ".WithMethods) does not list, quietly, in preflight");
    }

    // ── F14 ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void The_merged_production_configuration_allows_exactly_the_five_origins()
    {
        MergedProductionOrigins().Should().Equal(ProductionOrigins,
            "appsettings.json + appsettings.Production.json, merged the way the host merges them, name exactly these origins, in this order");
    }

    [Fact]
    public void The_merged_production_configuration_never_allows_plain_http_localhost_or_any_dev_origin()
    {
        var origins = MergedProductionOrigins();

        origins.Should().NotContain("http://localhost");
        origins.Should().NotContain(o => o.StartsWith("http://", StringComparison.OrdinalIgnoreCase),
            "no plain-http origin belongs in Production (the app is served over https, the Android app on https://localhost)");

        // No entry may come from the base file's developer list.
        var baseOnly = BaseOrigins().Except(ProductionOrigins);
        origins.Should().NotIntersectWith(baseOnly, "an origin from the base (development) list leaked into Production");
    }

    [Fact]
    public void The_merged_production_configuration_keeps_the_origins_the_app_and_the_phone_need()
    {
        var origins = MergedProductionOrigins();

        origins.Should().Contain("capacitor://localhost", "the iOS/older Capacitor WebView origin");
        origins.Should().Contain("https://localhost", "the Android app runs on https://localhost (androidScheme: 'https')");
        origins.Should().Contain("https://app.shramsafal.in");
        origins.Should().Contain("https://admin.shramsafal.in");
    }

    [Fact]
    public void The_production_list_is_at_least_as_long_as_the_base_list_so_no_base_entry_survives_the_merge()
    {
        // Arrays merge by index: entry i of Production overwrites entry i of the base. A Production list shorter than the
        // base list would leave the base's trailing entries (the developer's http origins) in the merged result.
        var production = new ConfigurationBuilder().AddJsonFile(ConfigPath("appsettings.Production.json"), optional: false).Build();

        var productionCount = production.GetSection("Cors:AllowedOrigins").GetChildren().Count();
        BaseOrigins().Count.Should().BeLessThanOrEqualTo(productionCount,
            "Production must list at least as many origins as appsettings.json, or the base list's tail leaks back in (F14)");
    }

    [Fact]
    public void The_production_environment_page_lists_the_same_origins_in_the_same_order()
    {
        // The page the operator copies the box's variables from once told people to set Cors__AllowedOrigins__4=http://localhost.
        var page = File.ReadAllText(Path.Combine(
            TestPathHelper.GetSolutionRoot(), "AgriSync.Bootstrapper", "PRODUCTION_ENVIRONMENT_VARIABLES.md"));

        var assigned = Regex.Matches(page, @"^Cors__AllowedOrigins__(\d+)=""([^""]*)""\s*$", RegexOptions.Multiline)
            .Select(m => (Index: int.Parse(m.Groups[1].Value), Origin: m.Groups[2].Value))
            .OrderBy(x => x.Index)
            .ToList();

        assigned.Select(x => x.Index).Should().Equal(Enumerable.Range(0, ProductionOrigins.Length));
        assigned.Select(x => x.Origin).Should().Equal(ProductionOrigins);
        assigned.Select(x => x.Origin).Should().NotContain("http://localhost");
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────

    /// <summary>The methods <c>.WithMethods(...)</c> lists in the AllowFrontend policy of Program.cs.</summary>
    private static HashSet<string> AllowedMethods()
    {
        var program = File.ReadAllText(Path.Combine(TestPathHelper.GetSolutionRoot(), "AgriSync.Bootstrapper", "Program.cs"));

        var start = program.IndexOf(".WithMethods(", StringComparison.Ordinal);
        Assert.True(start >= 0, "Program.cs must configure the AllowFrontend policy with .WithMethods(...).");
        var close = program.IndexOf(')', start);
        Assert.True(close > start, "Program.cs: .WithMethods(...) must be closed.");

        return Regex.Matches(program[start..close], "\"([A-Za-z]+)\"")
            .Select(m => m.Groups[1].Value.ToUpperInvariant())
            .ToHashSet();
    }

    /// <summary>The origins the Production host reads: appsettings.json overlaid with appsettings.Production.json.</summary>
    private static List<string> MergedProductionOrigins()
    {
        var merged = new ConfigurationBuilder()
            .AddJsonFile(ConfigPath("appsettings.json"), optional: false)
            .AddJsonFile(ConfigPath("appsettings.Production.json"), optional: false)
            .Build();
        return OriginsOf(merged);
    }

    private static List<string> BaseOrigins() =>
        OriginsOf(new ConfigurationBuilder().AddJsonFile(ConfigPath("appsettings.json"), optional: false).Build());

    private static List<string> OriginsOf(IConfiguration configuration) =>
        configuration.GetSection("Cors:AllowedOrigins").GetChildren()
            .OrderBy(c => int.Parse(c.Key))
            .Select(c => c.Value ?? string.Empty)
            .ToList();

    private static string ConfigPath(string fileName)
    {
        var path = Path.Combine(TestPathHelper.GetSolutionRoot(), "AgriSync.Bootstrapper", fileName);
        File.Exists(path).Should().BeTrue($"{fileName} must exist for this rule to mean anything");
        return path;
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
}
