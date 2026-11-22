// spec: plr-d10 SEC-1 server fixes (D-184), finding F09 - the E2E harness flag must never be on in Production.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using AgriSync.Bootstrapper.Composition;
using AgriSync.Bootstrapper.Infrastructure;
using FluentAssertions;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Tenancy;

/// <summary>
/// SEC-1 F09 - <c>ALLOW_E2E_SEED=true</c> opens the anonymous <c>/__e2e/fail-pushes</c> toggle and lifts the rate limits.
/// It is for test and CI hosts only, so a Production host that carries the flag must REFUSE TO START: the guard throws
/// <see cref="InvalidOperationException"/> naming the variable (never its value). Production with the flag false or not
/// set passes; Development and the CI environment ("CI") with the flag true do not throw.
///
/// <para>Two layers: the guard's truth table on its own, and the real Bootstrapper process (the way
/// <c>ServerRouteTableTests</c> runs it, with <c>--list-routes</c>: it builds the host exactly as it serves, lists its
/// routes and exits before serving) to prove the guard is actually wired into start-up in Production and only there.</para>
///
/// <para>Written from the SEC-1 test spec (F09) alone. The guard's and Program.cs's source were not read; the guard's name
/// and call shape are the only things taken from the code.</para>
/// </summary>
public sealed class E2eHarnessStartupGuardTests(ITestOutputHelper output)
{
    private const string Variable = "ALLOW_E2E_SEED";

    // ── the guard on its own ─────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("true")]
    [InlineData("TRUE")]
    [InlineData("True")]
    public void Production_with_the_flag_on_refuses_to_start_and_names_the_variable(string flag)
    {
        var act = () => E2eHarnessStartupGuard.EnsureSafeForEnvironment(isProduction: true, allowE2eSeedValue: flag);

        var ex = act.Should().Throw<InvalidOperationException>().Which;
        ex.Message.Should().Contain(Variable, "the operator must be told which variable to remove");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("false")]
    [InlineData("FALSE")]
    public void Production_with_the_flag_off_or_unset_passes(string? flag)
    {
        var act = () => E2eHarnessStartupGuard.EnsureSafeForEnvironment(isProduction: true, allowE2eSeedValue: flag);

        act.Should().NotThrow();
    }

    [Theory]
    [InlineData("true")]
    [InlineData("TRUE")]
    [InlineData("false")]
    [InlineData(null)]
    public void A_host_that_is_not_Production_never_throws_whatever_the_flag(string? flag)
    {
        // Development and the CI environment reach the guard as isProduction = false: the flag is theirs to use.
        var act = () => E2eHarnessStartupGuard.EnsureSafeForEnvironment(isProduction: false, allowE2eSeedValue: flag);

        act.Should().NotThrow();
    }

    // ── the real Bootstrapper process ────────────────────────────────────────────────────

    [Fact]
    public void The_real_host_in_Production_with_the_flag_on_does_not_start()
    {
        var (exitCode, text) = RunBootstrapper("Production", flag: "true");

        exitCode.Should().NotBe(0, "a Production host carrying ALLOW_E2E_SEED=true must refuse to start");
        text.Should().Contain(Variable, "the refusal names the variable the operator has to remove");
    }

    [Theory]
    [InlineData("false")]
    [InlineData(null)]
    public void The_real_host_in_Production_with_the_flag_off_or_unset_starts(string? flag)
    {
        var (exitCode, text) = RunBootstrapper("Production", flag);

        exitCode.Should().Be(0, "the flag being off is the normal Production posture; the host builds and lists its routes");
        text.Should().NotContain(Variable);
    }

    [Theory]
    [InlineData("CI")]
    [InlineData("Development")]
    public void The_real_host_in_a_test_environment_with_the_flag_on_still_starts(string environment)
    {
        var (exitCode, _) = RunBootstrapper(environment, flag: "true");

        exitCode.Should().Be(0, $"the flag is meant for {environment}; the guard must not stop it");
    }

    /// <summary>
    /// The real Bootstrapper, run with <c>--list-routes</c> (build the host as it serves, write the routes, exit) and the
    /// same placeholder configuration <c>ServerRouteTableTests</c> gives it: nothing is ever served and no database is
    /// reached (every connection string is an unreachable placeholder). The content root is an empty folder, so no
    /// appsettings or secrets file is read. <paramref name="flag"/> null leaves the variable unset.
    /// </summary>
    private (int ExitCode, string Text) RunBootstrapper(string environment, string? flag)
    {
        var bootstrapper = typeof(RouteTableCommand).Assembly.Location;
        var work = Path.Combine(Path.GetTempPath(), $"agrisync-e2e-guard-{Guid.NewGuid():N}");
        Directory.CreateDirectory(work);
        var outFile = Path.Combine(work, "routes.txt");
        const string NoDatabase = "Host=127.0.0.1;Port=1;Database=e2e_guard;Username=e2e_guard";
        try
        {
            var start = new ProcessStartInfo(Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet")
            {
                WorkingDirectory = work,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
            };

            // Nothing inherited from the developer's shell may steer this host: no connection string, no environment name,
            // no flag. Everything it needs is passed below, explicitly.
            var inherited = new List<string>();
            foreach (var key in start.Environment.Keys)
            {
                if (key.StartsWith("ConnectionStrings__", StringComparison.OrdinalIgnoreCase)
                    || key.StartsWith("ASPNETCORE_", StringComparison.OrdinalIgnoreCase)
                    || key.StartsWith("DOTNET_ENVIRONMENT", StringComparison.OrdinalIgnoreCase)
                    || key.Equals(Variable, StringComparison.OrdinalIgnoreCase))
                {
                    inherited.Add(key);
                }
            }

            foreach (var key in inherited)
            {
                start.Environment.Remove(key);
            }

            if (flag is not null)
            {
                start.Environment[Variable] = flag;
            }

            foreach (var arg in new[]
            {
                bootstrapper, RouteTableCommand.Flag, outFile,
                "--environment", environment,
                "--contentRoot", work,
                $"--ConnectionStrings:ShramSafalDb={NoDatabase}",
                $"--ConnectionStrings:UserDb={NoDatabase}",
                "--Cors:AllowedOrigins:0=https://e2e-guard.invalid",
                "--Jwt:SigningKey=e2e-guard-test-only-placeholder-signing-key-0000",
                // The Production SMS start-up guard refuses the dev stub; this host sends no SMS, so it is given the shape
                // of a configured gateway exactly as ServerRouteTableTests does.
                "--Msg91:UseDevStub=false",
                "--Msg91:AuthKey=e2e-guard-test-only-placeholder-auth-key",
                "--Msg91:TemplateId=e2e-guard-test-only-placeholder-template",
            })
            {
                start.ArgumentList.Add(arg);
            }

            using var process = Process.Start(start)!;
            var stdout = process.StandardOutput.ReadToEndAsync();
            var stderr = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(120_000))
            {
                process.Kill(entireProcessTree: true);
                throw new TimeoutException("The Bootstrapper did not exit within 120 s.");
            }

            var text = new StringBuilder().Append(stdout.Result).Append('\n').Append(stderr.Result).ToString();
            output.WriteLine($"[E2E-GUARD] env={environment} flag={flag ?? "<unset>"} exit {process.ExitCode}\n{text}");
            return (process.ExitCode, text);
        }
        finally
        {
            try { Directory.Delete(work, recursive: true); }
            catch (IOException) { /* a leftover temp folder is harmless; the next run uses a new one */ }
        }
    }
}
