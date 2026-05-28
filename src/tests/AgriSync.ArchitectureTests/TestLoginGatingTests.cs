using System.Text.Json;
using FluentAssertions;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// SARVAM_DEPLOY_READINESS gate B6 enabler — architecture-level
/// safeguards for the OTP test-login bypass.
///
/// Locks the founder rule 2026-05-28: "Production / default config does
/// not enable bypass." These assertions fail loudly in CI if anyone
/// changes appsettings.Production.json to enable the bypass, or removes
/// the explicit-false entry that prevents accidental env-var-only
/// overrides from being the sole source of truth.
///
/// Rationale: the runtime <see cref="User.Application.UseCases.Auth.TestLogin.TestLoginOptions"/>
/// defaults to <c>Enabled = false</c>, but env vars can override
/// appsettings at deploy time. We belt-and-suspender this by also
/// pinning Production's appsettings to an explicit <c>false</c> so
/// the deploy operator has to remove BOTH the appsettings entry AND
/// add an env var to flip the flag in prod.
/// </summary>
public sealed class TestLoginGatingTests
{
    private static readonly string RepoRoot = FindRepoRoot();

    [Fact]
    public void Production_appsettings_explicitly_disables_TestLogin()
    {
        var path = Path.Combine(
            RepoRoot, "src", "AgriSync.Bootstrapper", "appsettings.Production.json");

        File.Exists(path).Should().BeTrue($"appsettings.Production.json must exist at {path}");

        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        var root = doc.RootElement;

        root.TryGetProperty("TestLogin", out var testLogin).Should().BeTrue(
            "appsettings.Production.json MUST contain a TestLogin section so the prod posture is explicit, " +
            "not inferred from the default Options binding. " +
            "If you removed it, you weakened a SARVAM_DEPLOY_READINESS gate B6 safeguard.");

        testLogin.TryGetProperty("Enabled", out var enabled).Should().BeTrue(
            "TestLogin.Enabled must be present in appsettings.Production.json");
        enabled.ValueKind.Should().Be(JsonValueKind.False,
            "TestLogin.Enabled MUST be explicitly false in production appsettings — " +
            "this is the founder rule 'Do NOT enable bypass in production'");

        testLogin.TryGetProperty("AllowedPhoneNumbersE164", out var allowlist).Should().BeTrue(
            "TestLogin.AllowedPhoneNumbersE164 must be present (even if empty) so the shape is locked");
        allowlist.ValueKind.Should().Be(JsonValueKind.Array,
            "AllowedPhoneNumbersE164 must be an array");
        allowlist.GetArrayLength().Should().Be(0,
            "production allowlist MUST be empty — even if someone forced Enabled=true via env var, " +
            "an empty allowlist still allows nobody");
    }

    [Fact]
    public void Default_appsettings_does_not_enable_TestLogin()
    {
        // Top-level appsettings.json (non-environment-specific). May or
        // may not contain a TestLogin section; if it does, Enabled must
        // be false.
        var path = Path.Combine(
            RepoRoot, "src", "AgriSync.Bootstrapper", "appsettings.json");
        File.Exists(path).Should().BeTrue();

        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        if (!doc.RootElement.TryGetProperty("TestLogin", out var testLogin))
        {
            // Absent section → relies on TestLoginOptions class default
            // (Enabled = false). Verified separately in
            // TestLoginHandlerTests.Default_TestLoginOptions_disables_bypass.
            return;
        }

        if (testLogin.TryGetProperty("Enabled", out var enabled))
        {
            enabled.ValueKind.Should().NotBe(JsonValueKind.True,
                "default appsettings.json must NOT enable test-login");
        }
    }

    private static string FindRepoRoot()
    {
        // Walk up from the test bin folder until we find an ancestor
        // that contains "src/AgriSync.Bootstrapper/appsettings.Production.json".
        // The .sln file lives at <root>/src/AgriSync.sln (not at <root>),
        // so the .sln-search heuristic doesn't work — pin to the file
        // we actually want to read.
        var marker = Path.Combine("src", "AgriSync.Bootstrapper", "appsettings.Production.json");

        foreach (var startDir in new[] { AppContext.BaseDirectory, Directory.GetCurrentDirectory() })
        {
            var dir = new DirectoryInfo(startDir);
            while (dir is not null)
            {
                if (File.Exists(Path.Combine(dir.FullName, marker)))
                {
                    return dir.FullName;
                }
                dir = dir.Parent;
            }
        }

        throw new InvalidOperationException(
            $"Could not locate repo root containing '{marker}' from test runner context. " +
            $"BaseDirectory={AppContext.BaseDirectory}, Cwd={Directory.GetCurrentDirectory()}");
    }
}
