using Microsoft.Extensions.Configuration;

namespace AgriSync.Bootstrapper.Configuration;

/// <summary>
/// Public surface for wiring <see cref="SecretsManagerConfigurationSource"/>
/// into the Bootstrapper's configuration pipeline.
/// </summary>
public static class SecretsManagerConfigurationExtensions
{
    /// <summary>
    /// Registers the AWS Secrets Manager source LAST in the configuration
    /// chain — its values override env vars and appsettings, which is the
    /// behaviour the runbook expects when the env flag is set.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Reads the env vars itself rather than asking the caller to inspect
    /// the environment — keeps <c>Program.cs</c> a one-liner. Env vars:
    /// </para>
    /// <list type="bullet">
    /// <item><c>USE_SECRETS_MANAGER</c> — set to <c>"true"</c> to enable
    /// (any other value, including unset, leaves the chain untouched).</item>
    /// <item><c>SECRETS_MANAGER_SECRET_ID</c> — required when enabled.
    /// Default fallback is <c>shramsafal/prod/db-connection-string</c>
    /// to match the runbook.</item>
    /// <item><c>AWS_REGION</c> — optional, defaults to <c>ap-south-1</c>
    /// (the AgriSync prod region).</item>
    /// </list>
    /// </remarks>
    public static IConfigurationBuilder AddAgriSyncSecretsManager(this IConfigurationBuilder builder)
    {
        var enabled = string.Equals(
            Environment.GetEnvironmentVariable("USE_SECRETS_MANAGER"),
            "true",
            StringComparison.OrdinalIgnoreCase);

        if (!enabled)
        {
            return builder;
        }

        var secretId = Environment.GetEnvironmentVariable("SECRETS_MANAGER_SECRET_ID")
            ?? "shramsafal/prod/db-connection-string";
        var region = Environment.GetEnvironmentVariable("AWS_REGION")
            ?? "ap-south-1";

        builder.Add(new SecretsManagerConfigurationSource
        {
            SecretId = secretId,
            Region = region,
            Enabled = true,
        });

        return builder;
    }
}
