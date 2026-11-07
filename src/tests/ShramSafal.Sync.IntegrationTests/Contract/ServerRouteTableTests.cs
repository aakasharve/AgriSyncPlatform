// spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99 fix pass 1 (F100; review F-1), fix pass 2 (review N-3).
//
// The phone called 18 REST routes the server does not have, and nothing noticed. The phone's own test checks every REST
// path (and method) it calls against the server's route table
// (src/clients/mobile-web/src/infrastructure/api/__tests__/phoneRestPathsMatchServer.test.ts). That table is a checked-in
// file, sync-contract/routes/server-rest-routes.txt, and THIS test keeps it equal to the server.
//
// Fix pass 2 (N-3): the table is no longer built from a hand copy of Program.cs's mapping calls (a mapping REMOVED from
// Program.cs stayed in it). It runs the real Bootstrapper with `--list-routes`: Program.cs builds the production host
// exactly as it serves, maps everything, writes every endpoint of the built host and exits before serving (no hosted
// service, no port, no database). A mapping added, moved or removed in Program.cs or in any module therefore fails here
// until the file is regenerated, and the phone test then checks the phone against the new table.
//
// Regenerate the file: set AGRISYNC_WRITE_ROUTE_TABLE=1 and run this test once.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using AgriSync.Bootstrapper.Infrastructure;
using FluentAssertions;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Contract;

public sealed class ServerRouteTableTests(ITestOutputHelper output)
{
    private const string TableRelativePath = "sync-contract/routes/server-rest-routes.txt";
    private const string RegenerateVariable = "AGRISYNC_WRITE_ROUTE_TABLE";

    [Fact]
    public void The_checked_in_route_table_is_the_servers_route_table()
    {
        var live = LiveRouteTable();
        live.Count.Should().BeGreaterThan(150, "the host must map every module, or the table proves nothing");
        live.Should().Contain("POST /telemetry/client-error", "Program.cs's own inline routes are in the built host");
        live.Should().Contain("GET /shramsafal/me/erasure/requests", "the module routes are in the built host");
        live.Should().NotContain(r => r.Contains(" /test/", StringComparison.Ordinal) || r.Contains(" /__e2e", StringComparison.Ordinal),
            "the development and E2E harness routes are never served by the production host");

        var path = Path.Combine(RequiresPostgresConnection.RepoRoot(), TableRelativePath);
        if (Environment.GetEnvironmentVariable(RegenerateVariable) == "1")
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, Render(live), new UTF8Encoding(false));
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

    /// <summary>
    /// "METHOD /path" for every route the PRODUCTION host serves: the real Bootstrapper, run with `--list-routes`. The
    /// configuration it needs only to BUILD (it never connects) is placeholder values; its content root is an empty folder,
    /// so no local appsettings or secrets are read.
    /// </summary>
    private List<string> LiveRouteTable()
    {
        var bootstrapper = typeof(RouteTableCommand).Assembly.Location;
        var work = Path.Combine(Path.GetTempPath(), $"agrisync-route-table-{Guid.NewGuid():N}");
        Directory.CreateDirectory(work);
        var outFile = Path.Combine(work, "routes.txt");
        const string NoDatabase = "Host=127.0.0.1;Port=1;Database=route_table;Username=route_table";
        try
        {
            var start = new ProcessStartInfo(Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet")
            {
                WorkingDirectory = work,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
            };
            foreach (var arg in new[]
            {
                bootstrapper, RouteTableCommand.Flag, outFile,
                "--environment", "Production",
                "--contentRoot", work,
                $"--ConnectionStrings:ShramSafalDb={NoDatabase}",
                $"--ConnectionStrings:UserDb={NoDatabase}",
                "--Cors:AllowedOrigins:0=https://route-table.invalid",
                // A placeholder key only so the JWT options validate; nothing is ever signed here.
                "--Jwt:SigningKey=route-table-test-only-placeholder-signing-key-0000",
                // Since f08cd1c2 Production refuses to boot on the dev SMS stub (SmsGatewayStartupGuard). Placeholders only,
                // so the host builds; listing the routes never serves, so nothing is ever sent. (Found broken at the MU-2
                // merge commit c92e2e5d by lane MU-2 fix round 1.)
                "--Msg91:UseDevStub=false",
                "--Msg91:AuthKey=route-table-test-only-placeholder",
                "--Msg91:TemplateId=route-table-test-only-placeholder",
            })
            {
                start.ArgumentList.Add(arg);
            }

            using var process = Process.Start(start)!;
            var stdout = process.StandardOutput.ReadToEndAsync();
            var stderr = process.StandardError.ReadToEndAsync();
            process.WaitForExit(120_000).Should().BeTrue("listing the routes builds the host and exits; it never serves");
            output.WriteLine($"[ROUTE-TABLE] exit {process.ExitCode}\n{stdout.Result}\n{stderr.Result}");
            process.ExitCode.Should().Be(0, "the Bootstrapper must build and list its routes");

            return File.ReadAllLines(outFile).Select(l => l.Trim()).Where(l => l.Length > 0).ToList();
        }
        finally
        {
            try { Directory.Delete(work, recursive: true); }
            catch (IOException) { /* a leftover temp folder is harmless; the next run uses a new one */ }
        }
    }

    private static string Render(IReadOnlyList<string> routes)
    {
        var text = new StringBuilder();
        text.Append("# The server's REST route table: every route the production host serves (METHOD /path; * = any method).\n");
        text.Append("# GENERATED by ServerRouteTableTests (src/tests/ShramSafal.Sync.IntegrationTests/Contract) from the real\n");
        text.Append("# Bootstrapper (--list-routes); that test fails when this file differs. Regenerate with AGRISYNC_WRITE_ROUTE_TABLE=1.\n");
        text.Append("# Read by the phone's path test (src/clients/mobile-web/src/infrastructure/api/__tests__/phoneRestPathsMatchServer.test.ts).\n");
        text.Append("# Do not edit by hand.\n");
        foreach (var route in routes)
        {
            text.Append(route).Append('\n');
        }

        return text.ToString();
    }
}
