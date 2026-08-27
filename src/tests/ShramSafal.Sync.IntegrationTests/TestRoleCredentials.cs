using System;

namespace ShramSafal.Sync.IntegrationTests;

/// <summary>
/// Single source of truth for the non-superuser role credential the
/// RequiresPostgres suites use to prove FORCE-RLS is genuinely enforced.
/// </summary>
/// <remarks>
/// <para>
/// This credential was previously hardcoded as a literal in eight separate test
/// files. That made a local credential rotation break every RLS and money
/// invariant suite at once, and it meant a rotation could only be "fixed" by
/// pasting a new live secret into eight tracked files in a public repository.
/// </para>
/// <para>
/// The environment variable wins when set; the fallback literal is retained
/// deliberately so CI keeps working. In CI the scratch database is created in a
/// fresh Postgres container where no roles exist yet, so migration
/// <c>20260515090000_BootstrapDbRoles</c> genuinely runs its
/// <c>CREATE ROLE ... LOGIN PASSWORD</c> branch with this same literal. On a
/// developer machine the roles already exist, <c>IF NOT EXISTS</c> skips that
/// branch, and the role therefore carries whatever password the machine's
/// rotation set - which is why the override exists.
/// </para>
/// </remarks>
internal static class TestRoleCredentials
{
    public const string AppRoleUser = "agrisync_app";

    /// <summary>CI fallback - matches the literal in BootstrapDbRoles.</summary>
    private const string DefaultAppRolePassword = "dev_app_change_me";

    /// <summary><c>AGRISYNC_TEST_APP_ROLE_PASSWORD</c> overrides the fallback.</summary>
    public static string AppRolePassword =>
        Environment.GetEnvironmentVariable("AGRISYNC_TEST_APP_ROLE_PASSWORD")
        ?? DefaultAppRolePassword;
}
