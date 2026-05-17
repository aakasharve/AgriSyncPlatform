// spec: data-principle-spine-2026-05-05/06.3
using System.Text;
using Microsoft.Extensions.Options;

namespace AgriSync.BuildingBlocks.Consent;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 06 sub-phase 06.3 — dev / CI signing-key
/// resolver. Reads <see cref="ConsentSigningOptions.Hs256Secret"/> from
/// <c>IConfiguration</c> (mirror of the Phase 04 IpHasher salt pattern)
/// and serves it for any kid request. Bootstrapper registers this
/// adapter when <c>Consent:Hs256Secret</c> is set + the environment is
/// non-Production.
///
/// <para>
/// <b>Fixed-secret across kids.</b> Dev/CI doesn't run rotation, so
/// every kid resolves to the same bytes — that's fine for unit/integration
/// tests because the round-trip property tested here is "the validator
/// re-derives the same key that was used to sign", not "kid lookup
/// picks distinct secrets".
/// </para>
///
/// <para>
/// <b>Length guard.</b> HS256 requires &gt;=32 UTF8 bytes for security.
/// Throws <see cref="InvalidOperationException"/> at construction time
/// (NOT at call time) when the configured secret is too short, so a
/// misconfigured dev env surfaces the error at the first DI resolve
/// instead of mid-request.
/// </para>
/// </summary>
public sealed class EnvVarConsentSigningKeyResolver : IConsentSigningKeyResolver
{
    private const int MinSecretBytes = 32;

    private readonly byte[] _secret;
    private readonly string _currentKid;

    public EnvVarConsentSigningKeyResolver(IOptions<ConsentSigningOptions> options)
    {
        if (options?.Value is null)
        {
            throw new ArgumentNullException(nameof(options));
        }

        var secret = options.Value.Hs256Secret;
        if (string.IsNullOrWhiteSpace(secret))
        {
            throw new InvalidOperationException(
                "Consent:Hs256Secret is not configured. Set Consent:Hs256Secret " +
                "via Consent__Hs256Secret env var or appsettings.Development.json. " +
                "Production registers AwsSecretsManagerConsentSigningKeyResolver instead " +
                "and reads the secret from AWS Secrets Manager.");
        }

        var bytes = Encoding.UTF8.GetBytes(secret);
        if (bytes.Length < MinSecretBytes)
        {
            throw new InvalidOperationException(
                $"Consent:Hs256Secret must be at least {MinSecretBytes} UTF8 bytes " +
                $"(HS256 minimum secure length). Configured value is {bytes.Length} bytes.");
        }

        _secret = bytes;
        _currentKid = string.IsNullOrWhiteSpace(options.Value.Kid)
            ? "dev-2026-05"
            : options.Value.Kid.Trim();
    }

    public Task<string> GetCurrentKidAsync(CancellationToken ct) =>
        Task.FromResult(_currentKid);

    public Task<byte[]?> GetSecretByKidAsync(string kid, CancellationToken ct)
    {
        // Dev/CI has a single signing secret; rotation is a prod
        // concern. Any kid the caller presents resolves to the same
        // bytes so the round-trip property holds (sign→validate with
        // the same secret) regardless of which kid landed in the
        // header. A unit test that needs distinct kid → distinct
        // secret behaviour can compose
        // AwsSecretsManagerConsentSigningKeyResolver against LocalStack.
        return Task.FromResult<byte[]?>(_secret);
    }
}
