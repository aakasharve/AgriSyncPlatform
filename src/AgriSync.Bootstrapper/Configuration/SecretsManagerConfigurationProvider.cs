using System.Text.Json;
using Amazon;
using Amazon.SecretsManager;
using Amazon.SecretsManager.Model;
using Microsoft.Extensions.Configuration;

namespace AgriSync.Bootstrapper.Configuration;

/// <summary>
/// Reads a JSON secret from AWS Secrets Manager once at <see cref="Load"/>
/// time and exposes its top-level keys as configuration entries.
/// </summary>
/// <remarks>
/// <para>
/// Intentionally simple: synchronous load, single round-trip, no
/// background refresh. The secret is consumed at startup by the
/// connection-string resolver and EF migration pipeline; on-the-fly
/// rotation is out of scope for the v1 of this provider (the existing
/// env-var path doesn't refresh either).
/// </para>
/// <para>
/// Failure mode: the provider raises <see cref="InvalidOperationException"/>
/// rather than swallowing AWS errors. That matches the existing fail-fast
/// posture of the Bootstrapper — a missing secret should crash startup
/// loudly, not silently degrade to an empty connection string.
/// </para>
/// </remarks>
internal sealed class SecretsManagerConfigurationProvider : ConfigurationProvider
{
    private readonly SecretsManagerConfigurationSource _source;

    public SecretsManagerConfigurationProvider(SecretsManagerConfigurationSource source)
    {
        _source = source;
    }

    public override void Load()
    {
        if (!_source.Enabled)
        {
            return;
        }

        var client = _source.ClientOverride
            ?? new AmazonSecretsManagerClient(RegionEndpoint.GetBySystemName(_source.Region));

        try
        {
            var response = client
                .GetSecretValueAsync(new GetSecretValueRequest { SecretId = _source.SecretId })
                .GetAwaiter()
                .GetResult();

            if (string.IsNullOrWhiteSpace(response.SecretString))
            {
                throw new InvalidOperationException(
                    $"Secret '{_source.SecretId}' has no SecretString payload (binary secrets are not supported).");
            }

            using var document = JsonDocument.Parse(response.SecretString);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                throw new InvalidOperationException(
                    $"Secret '{_source.SecretId}' must be a JSON object whose keys mirror the IConfiguration shape (e.g. \"ConnectionStrings:UserDb\").");
            }

            foreach (var property in document.RootElement.EnumerateObject())
            {
                if (property.Value.ValueKind == JsonValueKind.String)
                {
                    Data[property.Name] = property.Value.GetString();
                }
                else
                {
                    Data[property.Name] = property.Value.GetRawText();
                }
            }
        }
        finally
        {
            if (_source.ClientOverride is null)
            {
                client.Dispose();
            }
        }
    }
}
