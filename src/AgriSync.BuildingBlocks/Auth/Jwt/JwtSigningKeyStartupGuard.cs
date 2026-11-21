namespace AgriSync.BuildingBlocks.Auth.Jwt;

/// <summary>
/// spec: trusted-control-room-2026-11-20 (CR-3 fix wave S-A3, AU-M4). Start-up refuses to run outside Development and
/// Testing when the JWT signing key is missing or is one of the signing-key values committed in this repository's
/// appsettings files. Those values are public: a server signing with one would let anyone mint a token for any account,
/// the control-room door mark and the founder included.
/// <para>Messages name the setting only, never a value.</para>
/// </summary>
public static class JwtSigningKeyStartupGuard
{
    /// <summary>
    /// Every <c>Jwt:SigningKey</c> value committed in an appsettings file of this repository (the coverage test reads the
    /// files and fails when a new one is not listed here).
    /// </summary>
    public static readonly IReadOnlyList<string> CommittedSigningKeys =
    [
        "CHANGE_ME_IN_CONFIGURATION_MIN_32_CHARS",
        "OVERRIDE_VIA_ENVIRONMENT_VARIABLE",
        "DEV-ONLY-CHANGE-IN-PROD-min-32-chars!!",
    ];

    /// <summary>The environments where a committed key is allowed (a developer's machine and test hosts).</summary>
    public static readonly IReadOnlyList<string> EnvironmentsAllowingCommittedKeys = ["Development", "Testing"];

    public static void EnsureSafeForEnvironment(string? environmentName, string? signingKey)
    {
        if (environmentName is not null
            && EnvironmentsAllowingCommittedKeys.Any(e => string.Equals(e, environmentName.Trim(), StringComparison.OrdinalIgnoreCase)))
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(signingKey))
        {
            throw new InvalidOperationException(
                "JWT signing key is not configured. Set the Jwt__SigningKey environment variable before starting the API.");
        }

        var key = signingKey.Trim();
        if (CommittedSigningKeys.Any(committed => string.Equals(committed, key, StringComparison.Ordinal)))
        {
            throw new InvalidOperationException(
                "JWT signing key is a value committed in this repository's appsettings files, so it is public. "
                + "Set the Jwt__SigningKey environment variable to a private key before starting the API.");
        }
    }
}
