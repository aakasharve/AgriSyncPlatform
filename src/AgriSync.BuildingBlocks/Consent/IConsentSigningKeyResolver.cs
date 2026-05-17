// spec: data-principle-spine-2026-05-05/06.3
namespace AgriSync.BuildingBlocks.Consent;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 06 sub-phase 06.3 — abstracts the source
/// of the HS256 signing key bytes for a given <c>kid</c>.
/// Production resolver hits AWS Secrets Manager; dev/CI resolver reads
/// from <c>IConfiguration</c>; null resolver throws (registered when
/// neither prod nor dev configuration is present).
///
/// <para>
/// <b>Rotation overlap.</b> The resolver MUST return a valid secret for
/// every kid that has shipped within the 7-day rotation window — the
/// rotation lambda writes the new secret under
/// <c>agrisync/consent/hs256/{newKid}</c> and updates the
/// <c>agrisync/consent/hs256/current</c> pointer; the OLD secret stays
/// available for unwrap until the lambda cleans it up 7 days later.
/// Returning <c>null</c> on a missing kid is the signal that the token
/// is unrecoverable (validation fails closed).
/// </para>
/// </summary>
public interface IConsentSigningKeyResolver
{
    /// <summary>
    /// The kid that <see cref="IConsentTokenService.IssueAsync"/> stamps
    /// into the JWT header. Production reads from the
    /// <c>agrisync/consent/hs256/current</c> pointer (so rotation
    /// promotes the new kid without a redeploy); dev/CI returns the
    /// <see cref="ConsentSigningOptions.Kid"/> verbatim.
    /// </summary>
    Task<string> GetCurrentKidAsync(CancellationToken ct);

    /// <summary>
    /// Resolve the raw HS256 secret bytes for a specific kid. Returns
    /// <c>null</c> when the kid is unknown (rotation has aged it out,
    /// the token is forged with a fake kid, etc.). Token validation
    /// treats <c>null</c> as fail-closed.
    /// </summary>
    Task<byte[]?> GetSecretByKidAsync(string kid, CancellationToken ct);
}
