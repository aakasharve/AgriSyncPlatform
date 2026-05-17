// spec: data-principle-spine-2026-05-05/06.3
//
// Sub-phase 06.3 — round-trip + load-bearing security tests for
// Hs256ConsentTokenService. Per OQ-3 verdict these can be unit-style
// (no LocalStack) when the resolver is mockable — we compose a
// hand-rolled InMemoryKeyResolver here so tests stay fast (no Docker,
// no AWS). The kid-in-payload-only test (load-bearing per supervisor)
// asserts that a forged token with the kid claim in the payload
// instead of the header is REJECTED with a signature-key-not-found
// failure.
//
// Coverage:
//   (a) Round-trip — issue then validate, claims preserved
//   (b) kid-in-payload-only — REJECTED (the load-bearing test)
//   (c) Rotation overlap — two kids both validate while both live in
//       the resolver
//   (d) Expired token — REJECTED

using System;
using System.Collections.Generic;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Consent;
using FluentAssertions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Consent;

public sealed class ConsentTokenTests
{
    // 32+ UTF8 bytes — HS256 minimum secure length.
    private static readonly byte[] SecretV1 = Encoding.UTF8.GetBytes(
        "dev-consent-secret-v1-must-be-32-bytes-or-more");
    private static readonly byte[] SecretV2 = Encoding.UTF8.GetBytes(
        "dev-consent-secret-v2-must-be-32-bytes-or-more");

    [Fact]
    public async Task RoundTrip_issue_then_validate_preserves_claims()
    {
        var resolver = new InMemoryKeyResolver("v1");
        resolver.Register("v1", SecretV1);
        var svc = new Hs256ConsentTokenService(resolver);
        var userId = Guid.NewGuid();
        var state = new ConsentClaims(
            FullHistoryJournal: true,
            CrossFarmAggregation: false,
            ResearchCorpusExport: true,
            Version: 3);

        var issued = await svc.IssueAsync(userId, state, CancellationToken.None);

        issued.Token.Should().NotBeNullOrWhiteSpace();
        issued.Kid.Should().Be("v1");
        issued.ExpiresAtUtc.Should().BeAfter(DateTime.UtcNow.AddHours(23));

        var validation = await svc.ValidateAsync(issued.Token, CancellationToken.None);

        validation.IsValid.Should().BeTrue(
            "a freshly-issued token must validate cleanly");
        validation.FailureReason.Should().BeNull();
        validation.UserId.Should().Be(userId);
        validation.Consents.Should().NotBeNull();
        validation.Consents!.FullHistoryJournal.Should().BeTrue();
        validation.Consents.CrossFarmAggregation.Should().BeFalse();
        validation.Consents.ResearchCorpusExport.Should().BeTrue();
        validation.Consents.Version.Should().Be(3);
    }

    [Fact]
    public async Task Token_with_kid_only_in_payload_is_rejected()
    {
        // LOAD-BEARING SECURITY TEST. Forge a token that mints WITHOUT
        // KeyId on the SymmetricSecurityKey (so the JWT header carries
        // no kid) but stuffs a "kid" claim into the PAYLOAD. RFC 7515
        // §4.1.4: kid MUST live in the protected header, never in the
        // payload. Our IssuerSigningKeyResolver reads kid from the
        // parsed JsonWebToken's Kid property (the HEADER); the
        // payload kid is invisible to the resolver and the validation
        // surfaces SecurityTokenSignatureKeyNotFoundException.
        var resolver = new InMemoryKeyResolver("v1");
        resolver.Register("v1", SecretV1);
        var svc = new Hs256ConsentTokenService(resolver);

        // Hand-craft the forged token: header has NO kid; payload
        // includes a fake "kid" claim. Sign with the same secret so
        // signature verification WOULD pass IF the resolver could find
        // the key — but it can't (header is empty).
        var keyWithoutKid = new SymmetricSecurityKey(SecretV1); // KeyId left unset → no kid in header
        var credentials = new SigningCredentials(keyWithoutKid, SecurityAlgorithms.HmacSha256);
        var handler = new JsonWebTokenHandler();
        var nowUtc = DateTime.UtcNow;
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = "agrisync-consent",
            Audience = "ssf.ai",
            NotBefore = nowUtc,
            Expires = nowUtc.AddHours(1),
            Claims = new Dictionary<string, object>
            {
                ["sub"] = Guid.NewGuid().ToString(),
                ["consents"] = "{\"fullHistoryJournal\":true,\"crossFarmAggregation\":true,\"researchCorpusExport\":true}",
                ["v"] = 1,
                ["kid"] = "v1", // PAYLOAD kid — must NOT be honoured by validation
            },
            SigningCredentials = credentials,
        };
        var forged = handler.CreateToken(descriptor);

        var validation = await svc.ValidateAsync(forged, CancellationToken.None);

        validation.IsValid.Should().BeFalse(
            "a token whose kid lives only in the payload MUST be rejected — " +
            "the issuer-signing-key resolver only consults the header (RFC 7515 §4.1.4)");
        validation.FailureReason.Should().NotBeNull();
    }

    [Fact]
    public async Task Rotation_overlap_old_kid_still_validates()
    {
        // Both v1 and v2 secrets live in the resolver (the 7-day
        // overlap window during a rotation). v1 was current when the
        // token was issued; v2 has since become current. The old
        // token must still validate.
        var resolver = new InMemoryKeyResolver("v1");
        resolver.Register("v1", SecretV1);
        var svc = new Hs256ConsentTokenService(resolver);

        var userId = Guid.NewGuid();
        var issued = await svc.IssueAsync(userId, new ConsentClaims(true, false, false, 1), CancellationToken.None);

        // Now the rotation lambda promotes v2: both kids exist in the
        // resolver; "current" points at v2.
        resolver.Register("v2", SecretV2);
        resolver.SetCurrent("v2");

        var validation = await svc.ValidateAsync(issued.Token, CancellationToken.None);

        validation.IsValid.Should().BeTrue(
            "during the 7-day rotation overlap, tokens minted with the previous kid " +
            "must still validate (the resolver still serves v1's secret)");
        validation.UserId.Should().Be(userId);
    }

    [Fact]
    public async Task Expired_token_is_rejected()
    {
        // Mint a token by hand with notBefore in the past and expires
        // also in the past, sign with v1, then validate via the
        // service. Validation must reject with a lifetime failure.
        var resolver = new InMemoryKeyResolver("v1");
        resolver.Register("v1", SecretV1);
        var svc = new Hs256ConsentTokenService(resolver);

        var key = new SymmetricSecurityKey(SecretV1) { KeyId = "v1" };
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var handler = new JsonWebTokenHandler();
        var nowUtc = DateTime.UtcNow;
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = "agrisync-consent",
            Audience = "ssf.ai",
            NotBefore = nowUtc.AddHours(-25),
            Expires = nowUtc.AddHours(-1),
            Claims = new Dictionary<string, object>
            {
                ["sub"] = Guid.NewGuid().ToString(),
                ["consents"] = "{\"fullHistoryJournal\":true,\"crossFarmAggregation\":false,\"researchCorpusExport\":false}",
                ["v"] = 1,
            },
            SigningCredentials = credentials,
        };
        var expired = handler.CreateToken(descriptor);

        var validation = await svc.ValidateAsync(expired, CancellationToken.None);

        validation.IsValid.Should().BeFalse("expired token must fail validation");
        validation.FailureReason.Should().NotBeNullOrWhiteSpace();
    }

    /// <summary>
    /// Hand-rolled IConsentSigningKeyResolver that the tests fully
    /// control. Lets a single test wire two kids to two secrets and
    /// flip the current pointer mid-test (rotation simulation).
    /// </summary>
    private sealed class InMemoryKeyResolver : IConsentSigningKeyResolver
    {
        private readonly Dictionary<string, byte[]> _secrets = new();
        private string _currentKid;

        public InMemoryKeyResolver(string initialCurrentKid)
        {
            _currentKid = initialCurrentKid;
        }

        public void Register(string kid, byte[] secret) => _secrets[kid] = secret;
        public void SetCurrent(string kid) => _currentKid = kid;

        public Task<string> GetCurrentKidAsync(CancellationToken ct) =>
            Task.FromResult(_currentKid);

        public Task<byte[]?> GetSecretByKidAsync(string kid, CancellationToken ct)
        {
            _secrets.TryGetValue(kid, out var bytes);
            return Task.FromResult(bytes);
        }
    }
}
