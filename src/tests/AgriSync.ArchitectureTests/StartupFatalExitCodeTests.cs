using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// spec: dfes-companion-2026-07-11 (wave-0.1) — Task 0.1, "a failed migration
/// must fail loudly".
///
/// <para>
/// <c>Program.cs</c> is top-level statements. The top-level <c>catch</c> that
/// wraps <c>InitializeApplicationDataAsync(app)</c> (originally at :732-735)
/// caught <c>Log.Fatal</c>'d the exception and then fell off the end of the
/// file — no <c>return</c>, no <c>Environment.Exit</c>. Because the file
/// contains <c>await</c> at the top level, the compiler infers
/// <c>async Task Main</c>, and *normal completion of Main* is process exit
/// code 0. A fatal startup exception (e.g. a migration that throws on boot —
/// the proven production migration lane, deploy <c>23222cdc</c>) therefore
/// looked to systemd exactly like a clean shutdown.
/// </para>
///
/// <para>
/// <b>Why this test shells out instead of using WebApplicationFactory:</b>
/// <c>WebApplicationFactory&lt;TEntryPoint&gt;</c> does not execute the
/// literal top-level <c>try</c>/<c>catch</c>/<c>finally</c> in
/// <c>Program.cs</c> — it reconstructs a host via reflection over a
/// <c>BuildWebHost</c>/<c>CreateHostBuilder</c>-shaped convention (or, for
/// top-level-statement programs, by re-invoking a synthesized
/// <c>Main</c> in a way that swaps out the hosting pieces for
/// <c>TestServer</c>). It never lets the process actually exit, so it
/// cannot observe an OS-level exit code, and it does not exercise the exact
/// catch block this bug lives in. There is also no <c>public partial class
/// Program</c> marker in this codebase (the implicit top-level Program
/// class is internal), so <c>WebApplicationFactory&lt;Program&gt;</c> is not
/// even available from another assembly without adding
/// <c>InternalsVisibleTo</c> — and even with that, it still would not
/// exercise the real entry point's catch block.
/// </para>
///
/// <para>
/// The only honest way to prove "the process's real exit code is non-zero"
/// is to run the actual built <c>AgriSync.Bootstrapper.dll</c> out-of-process
/// (this is Ranked Preference (1) from the task brief) and read
/// <see cref="Process.ExitCode"/> after it terminates.
/// </para>
///
/// <para>
/// <b>How the failure is forced:</b> a syntactically malformed Postgres
/// connection string is supplied via <c>ConnectionStrings__UserDb</c> (and
/// the Accounts/ShramSafal equivalents, since the User phase runs first and
/// would otherwise mask the later ones). Npgsql throws
/// <see cref="Exception"/> synchronously while constructing the connection
/// — no network round-trip, so the failure is fast and deterministic. The
/// throw happens inside
/// <c>ApplyStartupMigrationsIfAllowedAsync</c> → <c>GetPendingMigrationsAsync</c>,
/// which is the same guarded region, the same enclosing <c>try</c>
/// (Program.cs :937-1100 pre-fix), and the same propagation path
/// (uncaught → out of <c>InitializeApplicationDataAsync</c> → top-level
/// <c>catch</c>) as the documented
/// <c>context.Database.MigrateAsync()</c> / <c>migrator.MigrateAsync(...)</c>
/// call sites the brief traces end to end. <c>ASPNETCORE_ENVIRONMENT=Staging</c>
/// is required to route <c>InitializeApplicationDataAsync</c> through the
/// migration-application branch at all — the Development branch
/// (<c>EnsureContextTablesCreatedAsync</c>) never calls
/// <c>GetPendingMigrationsAsync</c>/<c>MigrateAsync</c>, and Staging (unlike
/// Production) does not require <c>ALLOW_PRODUCTION_STARTUP_MIGRATIONS</c> or
/// any other prod-only secret to reach that branch.
/// </para>
///
/// <para>
/// Verified manually before writing this test (see task-0.1-report.md): the
/// same malformed-connection-string repro run directly via
/// <c>dotnet AgriSync.Bootstrapper.dll</c> produced a stack trace ending in
/// <c>at Program.&lt;Main&gt;$(String[] args) in Program.cs:line 728</c> and
/// an observed process exit code of 0 before the fix, 1 after.
/// </para>
/// </summary>
public sealed class StartupFatalExitCodeTests
{
    private static readonly TimeSpan ProcessTimeout = TimeSpan.FromSeconds(45);

    [Fact]
    public async Task Startup_WhenMigrationPhaseThrows_ProcessExitCodeIsNonZero()
    {
        var dllPath = ResolveBootstrapperDllPath();
        var workingDirectory = Path.GetDirectoryName(dllPath)!;

        // Malformed on purpose: Npgsql fails to parse this synchronously,
        // so the exception is fast and does not depend on any real
        // Postgres instance being reachable.
        const string malformedConnectionString = "not-a-valid-connection-string;;;garbage===";

        var startInfo = new ProcessStartInfo
        {
            FileName = "dotnet",
            WorkingDirectory = workingDirectory,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        startInfo.ArgumentList.Add(dllPath);
        startInfo.Environment["ASPNETCORE_ENVIRONMENT"] = "Staging";
        startInfo.Environment["ConnectionStrings__UserDb"] = malformedConnectionString;
        startInfo.Environment["ConnectionStrings__ShramSafalDb"] = malformedConnectionString;
        startInfo.Environment["ConnectionStrings__AccountsDb"] = malformedConnectionString;

        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException(
                "Process.Start returned null for the AgriSync.Bootstrapper subprocess.");

        var stdOutTask = process.StandardOutput.ReadToEndAsync();
        var stdErrTask = process.StandardError.ReadToEndAsync();

        using var cts = new CancellationTokenSource(ProcessTimeout);
        try
        {
            await process.WaitForExitAsync(cts.Token);
        }
        catch (OperationCanceledException)
        {
            TryKill(process);
            var pendingStdOut = await SafeGetResultAsync(stdOutTask);
            var pendingStdErr = await SafeGetResultAsync(stdErrTask);
            throw new TimeoutException(
                $"AgriSync.Bootstrapper did not exit within {ProcessTimeout} — cannot observe an exit "
                + $"code. Captured output so far:\nSTDOUT:\n{pendingStdOut}\nSTDERR:\n{pendingStdErr}");
        }

        var stdOut = await stdOutTask;
        var stdErr = await stdErrTask;

        process.ExitCode.Should().NotBe(
            0,
            "a startup exception thrown while applying pending migrations "
            + "(Program.cs ApplyStartupMigrationsIfAllowedAsync -> "
            + "GetPendingMigrationsAsync/MigrateAsync) must not be reported to the "
            + "OS/systemd as a clean shutdown — a half-applied schema behind a down API "
            + "must not look like exit 0. Captured output:\n"
            + $"STDOUT:\n{stdOut}\nSTDERR:\n{stdErr}");
    }

    private static async Task<string> SafeGetResultAsync(Task<string> task)
    {
        try
        {
            return await task;
        }
        catch (Exception ex)
        {
            return $"<failed to read stream: {ex.Message}>";
        }
    }

    private static void TryKill(Process process)
    {
        try
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
            }
        }
        catch
        {
            // Best-effort cleanup only — never let teardown mask the real assertion failure.
        }
    }

    /// <summary>
    /// Locates the already-built <c>AgriSync.Bootstrapper.dll</c> relative to
    /// the solution root (walked up from this test assembly's own output
    /// directory), reusing the same Configuration/TargetFramework segment
    /// this test assembly was built with. The ArchitectureTests project
    /// already carries a <c>ProjectReference</c> to
    /// <c>AgriSync.Bootstrapper.csproj</c>, so <c>dotnet build</c>/<c>dotnet
    /// test</c> guarantees the Bootstrapper is built before this test can
    /// run — this method does not itself trigger a build.
    /// </summary>
    private static string ResolveBootstrapperDllPath()
    {
        var outputDir = new DirectoryInfo(AppContext.BaseDirectory);
        var targetFrameworkSegment = outputDir.Name;
        var configurationSegment = outputDir.Parent?.Name
            ?? throw new InvalidOperationException(
                $"Could not determine build configuration from test output path '{outputDir.FullName}'.");

        var srcDir = outputDir;
        while (srcDir is not null && !File.Exists(Path.Combine(srcDir.FullName, "AgriSync.sln")))
        {
            srcDir = srcDir.Parent;
        }

        if (srcDir is null)
        {
            throw new InvalidOperationException(
                $"Could not locate AgriSync.sln by walking up from '{AppContext.BaseDirectory}'. "
                + "This test resolves the built AgriSync.Bootstrapper.dll relative to the solution root.");
        }

        var dllPath = Path.Combine(
            srcDir.FullName,
            "AgriSync.Bootstrapper",
            "bin",
            configurationSegment,
            targetFrameworkSegment,
            "AgriSync.Bootstrapper.dll");

        if (!File.Exists(dllPath))
        {
            throw new FileNotFoundException(
                "AgriSync.Bootstrapper.dll not found at the expected build output path. Build "
                + "src/AgriSync.Bootstrapper (or the full solution) before running this test.",
                dllPath);
        }

        return dllPath;
    }
}
