// spec: trusted-control-room-2026-11-20 (CR-3 fix wave S-A3, AU-M4)
using System.Security.Cryptography;
using System.Text.Json;
using AgriSync.BuildingBlocks.Auth.Jwt;
using FluentAssertions;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// Start-up refuses to run outside Development and Testing when the JWT signing key is missing or is one of the
/// signing-key values committed in this repository's appsettings files (public, so anyone could mint any token, the
/// control-room door mark and the founder's included). The coverage test reads the committed files, so a new committed
/// key that the guard does not know fails here.
/// </summary>
public sealed class JwtSigningKeyStartupGuardTests
{
    public static IEnumerable<object[]> CommittedKeys =>
        JwtSigningKeyStartupGuard.CommittedSigningKeys.Select(k => new object[] { k });

    [Theory]
    [MemberData(nameof(CommittedKeys))]
    public void Production_refuses_a_committed_key_and_never_names_it(string key)
    {
        foreach (var environment in new[] { "Production", "Staging", "CI" })
        {
            var act = () => JwtSigningKeyStartupGuard.EnsureSafeForEnvironment(environment, key);

            var refusal = act.Should().Throw<InvalidOperationException>(environment).Which;
            refusal.Message.Should().Contain("Jwt__SigningKey").And.NotContain(key, "the message names the setting, never the value");
        }

        // The same value with stray spaces around it is the same public key.
        var padded = () => JwtSigningKeyStartupGuard.EnsureSafeForEnvironment("Production", "  " + key + " ");
        padded.Should().Throw<InvalidOperationException>();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Production_refuses_a_missing_key(string? key)
    {
        var act = () => JwtSigningKeyStartupGuard.EnsureSafeForEnvironment("Production", key);

        act.Should().Throw<InvalidOperationException>().WithMessage("*Jwt__SigningKey*");
    }

    [Theory]
    [InlineData("Development")]
    [InlineData("Testing")]
    [InlineData("testing")]
    public void Development_and_testing_may_run_on_a_committed_or_missing_key(string environment)
    {
        foreach (var key in JwtSigningKeyStartupGuard.CommittedSigningKeys.Append(string.Empty))
        {
            var act = () => JwtSigningKeyStartupGuard.EnsureSafeForEnvironment(environment, key);
            act.Should().NotThrow(environment);
        }
    }

    [Fact]
    public void A_private_key_starts_in_production()
    {
        var key = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));

        var act = () => JwtSigningKeyStartupGuard.EnsureSafeForEnvironment("Production", key);

        act.Should().NotThrow();
    }

    [Fact]
    public void Every_signing_key_committed_in_an_appsettings_file_is_refused_outside_development()
    {
        var src = TestPathHelper.GetSolutionRoot();
        var sep = Path.DirectorySeparatorChar;
        var files = Directory.EnumerateDirectories(src)
            .Where(d => !string.Equals(Path.GetFileName(d), "clients", StringComparison.OrdinalIgnoreCase))
            .SelectMany(d => Directory.EnumerateFiles(d, "appsettings*.json", SearchOption.AllDirectories))
            .Where(f => !f.Contains($"{sep}bin{sep}") && !f.Contains($"{sep}obj{sep}") && !f.Contains("node_modules"))
            .ToList();
        files.Should().NotBeEmpty("the API's appsettings files are committed under src");

        var committed = new List<(string File, string Key)>();
        foreach (var file in files)
        {
            using var doc = JsonDocument.Parse(
                File.ReadAllText(file),
                new JsonDocumentOptions { CommentHandling = JsonCommentHandling.Skip, AllowTrailingCommas = true });
            if (doc.RootElement.ValueKind == JsonValueKind.Object
                && doc.RootElement.TryGetProperty(JwtOptions.SectionName, out var jwt)
                && jwt.ValueKind == JsonValueKind.Object
                && jwt.TryGetProperty("SigningKey", out var key)
                && key.ValueKind == JsonValueKind.String
                && !string.IsNullOrWhiteSpace(key.GetString()))
            {
                committed.Add((Path.GetFileName(file), key.GetString()!));
            }
        }

        committed.Should().NotBeEmpty("at least one appsettings file carries a placeholder signing key");
        foreach (var (file, key) in committed)
        {
            var act = () => JwtSigningKeyStartupGuard.EnsureSafeForEnvironment("Production", key);
            act.Should().Throw<InvalidOperationException>($"the signing key committed in {file} is public");
        }
    }
}
