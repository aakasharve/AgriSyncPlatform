// spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99 fix pass 1 (F100; review F-1).
//
// The phone called 18 REST routes the server does not have (a missing /shramsafal prefix, or a path that never existed), and
// nothing noticed: each screen answered 404 and showed its failure. The phone's own test now checks every REST path it calls
// against the server's route table (src/clients/mobile-web/src/infrastructure/api/__tests__/phoneRestPathsMatchServer.test.ts).
// That table is a checked-in file, sync-contract/routes/server-rest-routes.txt, and THIS test keeps it current: it builds the
// production host's route table the way Program.cs maps it (every module and Bootstrapper mapping, plus the routes Program.cs
// maps inline, read from its own source) and fails when the file differs. A server change that adds, moves or removes a route
// therefore fails here until the file is regenerated, and the phone test then checks the phone against the new table.
//
// Regenerate the file: set AGRISYNC_WRITE_ROUTE_TABLE=1 and run this test once.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Accounts.Api;
using AgriSync.BuildingBlocks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.Bootstrapper;
using AgriSync.Bootstrapper.Endpoints;
using Analytics.Application;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Api;
using User.Api;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Contract;

public sealed class ServerRouteTableTests
{
    private const string TableRelativePath = "sync-contract/routes/server-rest-routes.txt";
    private const string RegenerateVariable = "AGRISYNC_WRITE_ROUTE_TABLE";

    [Fact]
    public void The_checked_in_route_table_is_the_servers_route_table()
    {
        var live = LiveRouteTable();
        live.Count.Should().BeGreaterThan(150, "the host must map every module, or the table proves nothing");

        var path = Path.Combine(RequiresPostgresConnection.RepoRoot(), TableRelativePath);
        var rendered = Render(live);
        if (Environment.GetEnvironmentVariable(RegenerateVariable) == "1")
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, rendered, new UTF8Encoding(false));
        }

        File.Exists(path).Should().BeTrue($"{TableRelativePath} is the table the phone's path test reads");
        var checkedIn = File.ReadAllLines(path)
            .Select(l => l.Trim())
            .Where(l => l.Length > 0 && !l.StartsWith('#'))
            .ToList();

        var missing = live.Except(checkedIn).ToList();
        var stale = checkedIn.Except(live).ToList();
        (missing.Count + stale.Count).Should().Be(0,
            $"{TableRelativePath} must equal the server's routes (set {RegenerateVariable}=1 and rerun to regenerate). "
            + $"Missing from the file: [{string.Join(", ", missing)}]. In the file but not on the server: [{string.Join(", ", stale)}].");
    }

    /// <summary>"METHOD /path" for every route the production host serves, sorted.</summary>
    private static List<string> LiveRouteTable()
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        // No database is opened: the host is built, its endpoints are read, and it is never started.
        const string NoDatabase = "Host=127.0.0.1;Port=1;Database=route_table;Username=route_table";
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:ShramSafalDb"] = NoDatabase,
            ["ConnectionStrings:UserDb"] = NoDatabase,
            // A placeholder key only so the JWT options validate; nothing is ever signed here.
            ["Jwt:SigningKey"] = "route-table-test-only-placeholder-signing-key-0000",
        });

        // The modules in Program.cs order.
        builder.Services.AddBuildingBlocks();
        builder.Services.AddUserApi(builder.Configuration);
        builder.Services.AddShramSafalApi(builder.Configuration);
        builder.Services.AddAccountsModule(builder.Configuration);
        builder.Services.AddAnalyticsApplication();
        builder.Services.AddAnalytics(o => o.UseInMemoryDatabase($"route-table-{Guid.NewGuid()}"));
        builder.Services.AddAppReleaseOptions(builder.Configuration);

        var app = builder.Build();

        // The mappings in Program.cs order (the env-gated eval and e2e routes are never served to a phone).
        app.MapAppRelease();
        app.MapUserApi();
        app.MapShramSafalApi();
        app.MapAccountsModuleEndpoints();
        app.MapFirstFarmBootstrapEndpoints();
        app.MapAccessExtensionAdminEndpoints();
        app.MapAnalyticsIngest();
        app.MapAdminFarmerHealth();

        // The host is never started, so its routes are read from its own route builder (the global EndpointDataSource is
        // filled only when the pipeline is built at start).
        var mapped = ((IEndpointRouteBuilder)app).DataSources.SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .SelectMany(e => (e.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods ?? ["GET"])
                .Select(m => $"{m} /{(e.RoutePattern.RawText ?? string.Empty).TrimStart('/')}"));

        return mapped.Concat(InlineProgramRoutes()).Distinct().OrderBy(r => r, StringComparer.Ordinal).ToList();
    }

    /// <summary>The routes Program.cs maps inline (health, version, the client-error telemetry), read from its own source.</summary>
    private static IEnumerable<string> InlineProgramRoutes()
    {
        var program = Path.Combine(RequiresPostgresConnection.RepoRoot(), "src", "AgriSync.Bootstrapper", "Program.cs");
        var source = File.ReadAllText(program);
        var routes = Regex.Matches(source, @"\bapp\.Map(Get|Post|Put|Patch|Delete)\(\s*""([^""]+)""")
            .Select(m => $"{m.Groups[1].Value.ToUpperInvariant()} {m.Groups[2].Value}")
            .Where(r => !r.Contains(" /test/", StringComparison.Ordinal)) // development-only harness routes
            .ToList();
        routes.Should().Contain("POST /telemetry/client-error", "the inline routes are read from Program.cs itself");
        return routes;
    }

    private static string Render(IReadOnlyList<string> routes)
    {
        var text = new StringBuilder();
        text.Append("# The server's REST route table: every route the production host serves (METHOD /path).\n");
        text.Append("# GENERATED by ServerRouteTableTests (src/tests/ShramSafal.Sync.IntegrationTests/Contract), which fails when this\n");
        text.Append("# file differs from the server; regenerate with AGRISYNC_WRITE_ROUTE_TABLE=1. Read by the phone's path test\n");
        text.Append("# (src/clients/mobile-web/src/infrastructure/api/__tests__/phoneRestPathsMatchServer.test.ts). Do not edit by hand.\n");
        foreach (var route in routes)
        {
            text.Append(route).Append('\n');
        }

        return text.ToString();
    }
}
