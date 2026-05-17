// spec: data-principle-spine-2026-05-05/06.3
using System.Security.Claims;
using System.Text.Json;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace AgriSync.BuildingBlocks.Consent;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 06 sub-phase 06.3 — HS256 consent token
/// service backed by <see cref="JsonWebTokenHandler"/> (per OQ-2
/// verdict, conflict-resolver 2026-05-17). Mints 24h tokens; validates
/// signature + lifetime + issuer + audience; rejects forged tokens
/// that put <c>kid</c> in the payload instead of the protected header.
///
/// <para>
/// <b>Why <see cref="JsonWebTokenHandler"/> not
/// <c>JwtSecurityTokenHandler</c>.</b> JsonWebTokenHandler is the
/// modern (System.IdentityModel.Tokens.Jwt has been frozen for years),
/// async-first, allocation-cheaper handler. The legacy
/// JwtSecurityTokenHandler still ships in
/// <c>User.Infrastructure.Security.JwtTokenIssuer</c> for the
/// identity-token path; consent is a brand-new flow and picks the
/// modern handler from day one. Both handlers share
/// <see cref="TokenValidationParameters"/> shape, so a future migration
/// of the identity path is a one-class change.
/// </para>
///
/// <para>
/// <b>kid binding to the header.</b> On issue,
/// <c>SecurityKey.KeyId = kid</c> propagates into the JWT header
/// automatically — verified by the
/// <c>Token_with_kid_only_in_payload_is_rejected</c> integration test
/// in <c>ConsentTokenTests</c>. On validation, the
/// <see cref="TokenValidationParameters.IssuerSigningKeyResolver"/>
/// callback reads kid from the parsed <see cref="JsonWebToken"/>
/// (which exposes header claims via the <c>Kid</c> property) and looks
/// up the secret bytes via
/// <see cref="IConsentSigningKeyResolver.GetSecretByKidAsync"/>. A
/// token whose kid lives only in the payload returns the default
/// <see cref="JsonWebToken.Kid"/> of empty string; the resolver
/// returns no keys; validation fails with
/// <c>SecurityTokenSignatureKeyNotFoundException</c>.
/// </para>
///
/// <para>
/// <b>Audience.</b> Two-element <c>ValidAudiences</c> array: <c>ssf.ai</c>
/// (the Phase 07 voice-input boundary that Phase 06 builds the primitives
/// for) and <c>ssf.attachments</c> (a future Phase 09 attachments-finalize
/// flow). Adding a third audience is a config change, not a code change.
/// </para>
/// </summary>
public sealed class Hs256ConsentTokenService : IConsentTokenService
{
    private const string Issuer = "agrisync-consent";
    // Per envelope: SecurityTokenDescriptor stamps a single Audience.
    // Validation accepts either — see ValidAudiences below.
    private const string DefaultAudience = "ssf.ai";

    // 24-hour TTL per V2 §B.0 and plan §6.3.
    private static readonly TimeSpan TokenLifetime = TimeSpan.FromHours(24);
    private static readonly TimeSpan ClockSkew = TimeSpan.FromSeconds(30);

    private static readonly string[] ValidAudiences = { "ssf.ai", "ssf.attachments" };

    private readonly IConsentSigningKeyResolver _keys;
    private readonly JsonWebTokenHandler _handler = new();

    public Hs256ConsentTokenService(IConsentSigningKeyResolver keys)
    {
        _keys = keys ?? throw new ArgumentNullException(nameof(keys));
    }

    public async Task<ConsentTokenIssued> IssueAsync(Guid userId, ConsentClaims state, CancellationToken ct)
    {
        if (userId == Guid.Empty)
        {
            throw new ArgumentException("userId required", nameof(userId));
        }
        if (state is null)
        {
            throw new ArgumentNullException(nameof(state));
        }

        var kid = await _keys.GetCurrentKidAsync(ct).ConfigureAwait(false);
        var secret = await _keys.GetSecretByKidAsync(kid, ct).ConfigureAwait(false);
        if (secret is null)
        {
            throw new InvalidOperationException(
                $"Current consent signing key '{kid}' not found in resolver. " +
                "Check Secrets Manager rotation state or dev configuration.");
        }

        var key = new SymmetricSecurityKey(secret) { KeyId = kid };
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var nowUtc = DateTime.UtcNow;
        var expiresAtUtc = nowUtc.Add(TokenLifetime);

        // Serialise consent claims as one JSON object stamped under
        // "consents". JsonWebTokenHandler's claim serialiser handles
        // primitives but not nested anonymous types — serialise the
        // object once and store the JSON string; validation parses it
        // back inside ValidateAsync. (System.Text.Json default
        // serialiser is fine here; the field set is fixed.)
        var consentsJson = JsonSerializer.Serialize(new
        {
            fullHistoryJournal = state.FullHistoryJournal,
            crossFarmAggregation = state.CrossFarmAggregation,
            researchCorpusExport = state.ResearchCorpusExport,
        });

        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = DefaultAudience,
            NotBefore = nowUtc,
            Expires = expiresAtUtc,
            // SecurityTokenDescriptor.Claims is a Dictionary<string, object>
            // that the handler hoists into the payload. The "sub" claim
            // carries the user id; "consents" carries the JSON blob;
            // "v" carries the consent text version.
            Claims = new Dictionary<string, object>
            {
                ["sub"] = userId.ToString(),
                ["consents"] = consentsJson,
                ["v"] = state.Version,
            },
            SigningCredentials = credentials,
        };

        var token = _handler.CreateToken(descriptor);

        return new ConsentTokenIssued(token, kid, expiresAtUtc);
    }

    public async Task<ConsentTokenValidation> ValidateAsync(string token, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            return new ConsentTokenValidation(false, null, null, "token missing");
        }

        // Pre-parse outside ValidateTokenAsync so the issuer-signing-key
        // resolver below can capture the kid from the header. The
        // resolver receives the parsed SecurityToken (a JsonWebToken)
        // and reads its Kid property — which is sourced from the
        // HEADER, never from the payload (this is the load-bearing
        // assertion proven by the kid-in-payload-only test).
        var validationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = Issuer,
            ValidateAudience = true,
            ValidAudiences = ValidAudiences,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ClockSkew = ClockSkew,
            // RFC 7515 §4.1.4 enforcement happens here: kid is read
            // from securityToken.Kid (header), NOT from the payload
            // claims. A token with kid in the payload only returns
            // empty-string Kid → resolver returns no keys → validation
            // fails with SecurityTokenSignatureKeyNotFoundException.
            IssuerSigningKeyResolver = (rawToken, securityToken, kid, parameters) =>
            {
                // JsonWebToken.Kid surfaces the JWT HEADER's kid (or the
                // empty string if absent). Cast to the concrete type
                // since the base SecurityToken does not expose Kid; the
                // JsonWebTokenHandler always hands a JsonWebToken to the
                // resolver. The `kid` callback parameter on this
                // delegate is sourced from the same header read — using
                // it directly is equivalent — but routing through the
                // parsed token is the form the test asserts on, and it
                // keeps the load-bearing "header, not payload" intent
                // explicit in the code.
                string? headerKid = null;
                if (securityToken is JsonWebToken jwt)
                {
                    headerKid = jwt.Kid;
                }
                else if (!string.IsNullOrWhiteSpace(kid))
                {
                    // Defensive fallback: any future handler swap that
                    // hands a non-JsonWebToken still gets the same
                    // header-sourced kid via the delegate parameter.
                    headerKid = kid;
                }

                if (string.IsNullOrWhiteSpace(headerKid))
                {
                    return Array.Empty<SecurityKey>();
                }

                var bytes = _keys
                    .GetSecretByKidAsync(headerKid, ct)
                    .GetAwaiter()
                    .GetResult();

                if (bytes is null)
                {
                    return Array.Empty<SecurityKey>();
                }

                return new[] { (SecurityKey)new SymmetricSecurityKey(bytes) { KeyId = headerKid } };
            },
        };

        TokenValidationResult result;
        try
        {
            result = await _handler.ValidateTokenAsync(token, validationParameters).ConfigureAwait(false);
        }
        catch (SecurityTokenException stx)
        {
            // Most signature / lifetime / audience failures surface via
            // result.IsValid = false; catch the residual throw paths
            // (malformed token, non-JWT input) so the caller never sees
            // a stack trace.
            return new ConsentTokenValidation(false, null, null, stx.Message);
        }

        if (!result.IsValid)
        {
            // Failure reason: prefer the inner exception's message
            // (more specific) but fall back to a plain "invalid".
            var reason = result.Exception?.Message ?? "invalid";
            return new ConsentTokenValidation(false, null, null, reason);
        }

        // Pull claims back out. result.ClaimsIdentity gives the
        // canonical-claim view; "sub" returns the user id we stamped.
        var identity = result.ClaimsIdentity;
        var subject = identity?.FindFirst("sub")?.Value
            ?? identity?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrWhiteSpace(subject) || !Guid.TryParse(subject, out var userId))
        {
            return new ConsentTokenValidation(false, null, null, "sub claim missing or not a Guid");
        }

        var consentsRaw = identity?.FindFirst("consents")?.Value;
        var versionRaw = identity?.FindFirst("v")?.Value;
        if (string.IsNullOrWhiteSpace(consentsRaw) || string.IsNullOrWhiteSpace(versionRaw)
            || !int.TryParse(versionRaw, out var version))
        {
            return new ConsentTokenValidation(false, null, null, "consents / v claim missing or malformed");
        }

        ConsentClaims claims;
        try
        {
            // Case-insensitive match: IssueAsync writes camelCase keys
            // (matches the wire convention) but the DTO below uses
            // PascalCase property names per the C# naming convention.
            // PropertyNameCaseInsensitive bridges the two without
            // forcing a [JsonPropertyName] attribute on every property.
            var parsed = JsonSerializer.Deserialize<ConsentClaimsDto>(consentsRaw, DeserializeOptions)
                ?? throw new InvalidOperationException("consents JSON deserialised to null");
            claims = new ConsentClaims(
                FullHistoryJournal: parsed.FullHistoryJournal,
                CrossFarmAggregation: parsed.CrossFarmAggregation,
                ResearchCorpusExport: parsed.ResearchCorpusExport,
                Version: version);
        }
        catch (JsonException jex)
        {
            return new ConsentTokenValidation(false, null, null, "consents JSON malformed: " + jex.Message);
        }

        return new ConsentTokenValidation(true, userId, claims, null);
    }

    private static readonly JsonSerializerOptions DeserializeOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    /// <summary>
    /// DTO for the <c>consents</c> JSON blob; intentionally permissive
    /// (default-false on missing fields) so an older token version that
    /// did not yet carry one of the three toggles parses cleanly into
    /// the stricter-wins evaluation downstream.
    /// </summary>
    private sealed class ConsentClaimsDto
    {
        public bool FullHistoryJournal { get; set; }
        public bool CrossFarmAggregation { get; set; }
        public bool ResearchCorpusExport { get; set; }
    }
}
