// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID fix pass 1 (review M4, register F103).
// Fix pass 2: ONE copy, compiled into both real-Postgres test projects (ShramSafal.Sync.IntegrationTests and
// ShramSafal.Admin.IntegrationTests) as a linked item, so the two guards can never drift apart.
using System;
using System.Collections;
using System.Runtime.CompilerServices;

namespace AgriSync.TestSupport;

/// <summary>
/// No test host in this process can reach a database it was not given. A developer's machine may carry
/// <c>ConnectionStrings__*</c> variables naming his OWN database (on this PC, the founder's :5433), and every host built
/// with <c>WebApplication.CreateBuilder</c> reads them — and, below them, the appsettings files copied into the test
/// output, which name the same kind of database. So, once, before any test runs, for THIS PROCESS ONLY (the machine's
/// own settings are untouched):
/// <list type="number">
/// <item>every inherited <c>ConnectionStrings__*</c> variable is cleared;</item>
/// <item>each connection-string name the app knows is set to <see cref="Sentinel"/>, a host that can never resolve, which
/// outranks the appsettings files. A host that does not name its database fails closed instead of reaching any.</item>
/// </list>
/// A port check could not be the guard: CI's throwaway database is also localhost:5433. Tests that need a database get
/// it from <c>REQUIRES_POSTGRES_ROOT_CONN</c> / <c>ADMIN_TESTS_ADMIN_ROOT_CONN</c> (never touched here) and hand it to
/// their host explicitly.
/// </summary>
internal static class TestProcessConnectionGuard
{
    /// <summary>The <c>.invalid</c> top-level name never resolves (RFC 2606); port 1 and a short timeout make it quick.</summary>
    public const string Sentinel =
        "Host=no-database-configured.invalid;Port=1;Database=none;Username=none;Password=none;Timeout=3;Command Timeout=3";

    public static readonly string[] KnownNames =
        ["UserDb", "UserDb_Migration", "UserDb_ReadOnly", "ShramSafalDb", "ShramSafalDb_Migration", "ShramSafalDb_ReadOnly"];

    [ModuleInitializer]
    internal static void FailClosed()
    {
        foreach (DictionaryEntry entry in Environment.GetEnvironmentVariables())
        {
            if (entry.Key is string name && name.StartsWith("ConnectionStrings__", StringComparison.OrdinalIgnoreCase))
            {
                Environment.SetEnvironmentVariable(name, null);
            }
        }

        foreach (var name in KnownNames)
        {
            Environment.SetEnvironmentVariable($"ConnectionStrings__{name}", Sentinel);
        }
    }
}
