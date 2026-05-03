using Amazon;
using Amazon.SecretsManager;
using Microsoft.Extensions.Configuration;

namespace AgriSync.Bootstrapper.Configuration;

/// <summary>
/// Configuration source that pulls a JSON secret from AWS Secrets Manager
/// and flattens it into the configuration tree under the standard
/// colon-separated key shape (e.g. <c>ConnectionStrings:UserDb</c>).
/// </summary>
/// <remarks>
/// <para>
/// Wired by <see cref="SecretsManagerConfigurationExtensions"/>. Default
/// is OFF — call sites only register this source when
/// <c>USE_SECRETS_MANAGER=true</c> in the environment, which keeps the
/// laptop-dev path (env vars + appsettings) untouched.
/// </para>
/// <para>
/// Designed so the secret payload mirrors the existing
/// <see cref="IConfiguration"/> shape verbatim. Example secret JSON:
/// <code>
/// {
///   "ConnectionStrings:UserDb":     "Host=...;Username=...;Password=...",
///   "ConnectionStrings:ShramSafalDb":"Host=...;Username=...;Password=...",
///   "ConnectionStrings:AnalyticsDb": "Host=...;Username=...;Password=..."
/// }
/// </code>
/// Downstream code keeps calling
/// <see cref="ConfigurationExtensions.GetConnectionString"/> with no change.
/// </para>
/// <para>
/// IAM expectation: the runtime principal (EC2 instance-profile role for
/// the API box, or the operator's user/role for ad-hoc agent runs) must
/// hold <c>secretsmanager:GetSecretValue</c> on
/// <see cref="SecretsManagerConfigurationSource.SecretId"/>.
/// </para>
/// </remarks>
public sealed class SecretsManagerConfigurationSource : IConfigurationSource
{
    public required string SecretId { get; init; }
    public required string Region { get; init; }

    /// <summary>
    /// Optional: inject a pre-built client (used by tests). When null,
    /// the provider builds a real <see cref="AmazonSecretsManagerClient"/>
    /// against the configured <see cref="Region"/>.
    /// </summary>
    public IAmazonSecretsManager? ClientOverride { get; init; }

    /// <summary>
    /// When false, the provider returns immediately without calling AWS.
    /// Lets callers register the source unconditionally and toggle by env
    /// var, keeping <see cref="Program"/> wiring clean.
    /// </summary>
    public bool Enabled { get; init; } = true;

    public IConfigurationProvider Build(IConfigurationBuilder builder) =>
        new SecretsManagerConfigurationProvider(this);
}
