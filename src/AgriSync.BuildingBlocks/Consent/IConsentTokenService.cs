// spec: data-principle-spine-2026-05-05/06.3
namespace AgriSync.BuildingBlocks.Consent;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 06 sub-phase 06.3 — issues + validates the
/// short-lived HS256 consent token the client carries at clip-upload
/// finalize time. 24-hour TTL. Key rotation overlap: ValidateAsync
/// accepts any <c>kid</c> the resolver still knows the secret for, so
/// a 7-day rotation overlap (current + previous) is a config concern,
/// not a code concern.
///
/// <para>
/// <b>Per OQ-2 verdict</b> (conflict-resolver 2026-05-17): implemented
/// with <see cref="Microsoft.IdentityModel.JsonWebTokens.JsonWebTokenHandler"/>
/// — NOT the legacy <c>JwtSecurityTokenHandler</c>, and NOT JWT.NET.
/// The project standardised on Microsoft.IdentityModel.Tokens in
/// <c>JwtTokenIssuer.cs</c> + <c>TokenValidationExtensions.cs</c>;
/// adding a second JWT library creates two-library drift forever.
/// </para>
///
/// <para>
/// <b>kid lives in the HEADER, never in the payload</b> (RFC 7515
/// §4.1.4). The issuer-signing-key resolver inside
/// <c>ValidateAsync</c> reads the <c>kid</c> from
/// <c>SecurityToken.Headers</c>; a forged token that puts <c>kid</c>
/// only in the payload claims surfaces as
/// <c>SecurityTokenSignatureKeyNotFoundException</c> at validation
/// time and the token is rejected.
/// </para>
/// </summary>
public interface IConsentTokenService
{
    /// <summary>
    /// Mint a fresh 24h HS256 token for <paramref name="userId"/>,
    /// stamping the supplied consent claims in the payload.
    /// <see cref="ConsentTokenIssued.Kid"/> is the current key
    /// identifier (so the client can persist it alongside the clip and
    /// the server can re-resolve the secret on validation).
    /// </summary>
    Task<ConsentTokenIssued> IssueAsync(Guid userId, ConsentClaims state, CancellationToken ct);

    /// <summary>
    /// Validate a token. Returns
    /// <c>IsValid = false</c> + a human-readable failure reason on any
    /// signature / expiry / kid-missing failure rather than throwing —
    /// callers route the failure into a 400 / 401 response.
    /// </summary>
    Task<ConsentTokenValidation> ValidateAsync(string token, CancellationToken ct);
}

/// <summary>
/// Issued-token envelope returned by
/// <see cref="IConsentTokenService.IssueAsync"/>.
/// </summary>
/// <param name="Token">Compact JWT serialization.</param>
/// <param name="Kid">
/// Key identifier of the signing key used. Persisted by the client
/// alongside the clip so the server can re-resolve the same secret on
/// the validation round-trip.
/// </param>
/// <param name="ExpiresAtUtc">
/// 24h from <see cref="IConsentTokenService.IssueAsync"/>. The frontend
/// caches in memory and refetches near expiry.
/// </param>
public sealed record ConsentTokenIssued(string Token, string Kid, DateTime ExpiresAtUtc);

/// <summary>
/// Validation outcome. On success, <see cref="UserId"/> +
/// <see cref="Consents"/> hold the claims the token carried; on
/// failure, <see cref="FailureReason"/> documents why (caller treats
/// failure as 400 / 401).
/// </summary>
public sealed record ConsentTokenValidation(
    bool IsValid,
    Guid? UserId,
    ConsentClaims? Consents,
    string? FailureReason);

/// <summary>
/// The three independent purpose toggles + the consent text version the
/// user agreed to. Mirrors the live <c>UserConsentState</c> read-side
/// shape — minus the timestamps and current_token_kid that the token
/// itself does not need to carry.
/// </summary>
public sealed record ConsentClaims(
    bool FullHistoryJournal,
    bool CrossFarmAggregation,
    bool ResearchCorpusExport,
    int Version);
