using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using User.Domain.Security;
using Xunit;

namespace UserDomainTests.Auth;

/// <summary>
/// Unit tests for the device-session model introduced by
/// spec: secure-remembered-device-sessions-2026-06-24.
/// Covers all eight behavioural requirements listed in Task 1.1.
/// </summary>
public class RefreshTokenSessionTests
{
    private static RefreshToken BuildToken(
        string tokenHash = "hash-abc",
        string deviceId = "device-001",
        string? deviceName = "My Phone",
        string platform = "android",
        DateTime? createdAt = null,
        DateTime? expiresAt = null)
    {
        var now = createdAt ?? new DateTime(2026, 6, 27, 10, 0, 0, DateTimeKind.Utc);
        var exp = expiresAt ?? now.AddDays(30);
        return new RefreshToken(
            Guid.NewGuid(),
            new UserId(Guid.NewGuid()),
            tokenHash,
            deviceId,
            deviceName,
            platform,
            now,
            exp);
    }

    // Test 1 — Constructor maps fields correctly; LastUsedAtUtc starts equal to CreatedAtUtc.
    [Fact]
    public void Constructor_sets_all_device_fields_and_LastUsedAtUtc_equals_CreatedAtUtc()
    {
        var userId = new UserId(Guid.NewGuid());
        var id = Guid.NewGuid();
        var created = new DateTime(2026, 6, 27, 8, 0, 0, DateTimeKind.Utc);
        var expires = created.AddDays(30);

        var token = new RefreshToken(
            id,
            userId,
            "hash-abc",
            "device-001",
            "My Phone",
            "android",
            created,
            expires);

        token.Id.Should().Be(id);
        token.UserId.Should().Be(userId);
        token.TokenHash.Should().Be("hash-abc");
        token.DeviceId.Should().Be("device-001");
        token.DeviceName.Should().Be("My Phone");
        token.Platform.Should().Be("android");
        token.CreatedAtUtc.Should().Be(created);
        token.ExpiresAtUtc.Should().Be(expires);
        token.LastUsedAtUtc.Should().Be(created, "LastUsedAtUtc must equal CreatedAtUtc on construction");
    }

    // Test 2 — Blank/null deviceName becomes null; padded name is trimmed.
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Blank_deviceName_becomes_null(string? name)
    {
        var token = BuildToken(deviceName: name);
        token.DeviceName.Should().BeNull();
    }

    [Fact]
    public void Padded_deviceName_is_trimmed()
    {
        var token = BuildToken(deviceName: "  Samsung Galaxy  ");
        token.DeviceName.Should().Be("Samsung Galaxy");
    }

    // Test 3 — Blank platform becomes "unknown"; real platform is trimmed.
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Blank_platform_becomes_unknown(string? platform)
    {
        var token = new RefreshToken(
            Guid.NewGuid(),
            new UserId(Guid.NewGuid()),
            "hash-abc",
            "device-001",
            "My Phone",
            platform!,
            DateTime.UtcNow,
            DateTime.UtcNow.AddDays(30));

        token.Platform.Should().Be("unknown");
    }

    [Fact]
    public void Real_platform_is_trimmed()
    {
        var token = BuildToken(platform: "  ios  ");
        token.Platform.Should().Be("ios");
    }

    // Test 4 — No public raw "Token" property; only TokenHash is exposed.
    [Fact]
    public void RefreshToken_has_no_public_Token_property()
    {
        var tokenProperty = typeof(RefreshToken).GetProperty("Token");
        tokenProperty.Should().BeNull("raw token must not be persisted; only the hash is stored");
    }

    // Test 5 — IsActive / IsExpired / IsRevoked state machine.
    [Fact]
    public void Fresh_token_is_active_expired_token_is_not_active_revoked_token_is_not_active()
    {
        var created = new DateTime(2026, 6, 27, 8, 0, 0, DateTimeKind.Utc);
        var expires = created.AddDays(30);
        var token = BuildToken(createdAt: created, expiresAt: expires);

        // Active immediately after creation
        token.IsActive(created.AddMinutes(1)).Should().BeTrue("a fresh, non-revoked token is active");

        // Not active once the clock passes ExpiresAtUtc
        token.IsActive(expires).Should().BeFalse("token at exactly its expiry is expired, hence not active");
        token.IsActive(expires.AddSeconds(1)).Should().BeFalse("token past expiry is not active");

        // Not active once revoked (even before expiry)
        token.Revoke(created.AddDays(1));
        token.IsActive(created.AddDays(2)).Should().BeFalse("revoked token is never active");
    }

    // Test 6 — MarkUsed updates LastUsedAtUtc.
    [Fact]
    public void MarkUsed_updates_LastUsedAtUtc()
    {
        var created = new DateTime(2026, 6, 27, 8, 0, 0, DateTimeKind.Utc);
        var token = BuildToken(createdAt: created);

        var usedAt = created.AddHours(2);
        token.MarkUsed(usedAt);

        token.LastUsedAtUtc.Should().Be(usedAt);
    }

    // Test 7 — Revoke sets RevokedAtUtc and RevocationReason; default reason is "revoked".
    [Fact]
    public void Revoke_with_explicit_reason_sets_RevokedAtUtc_and_RevocationReason()
    {
        var token = BuildToken();
        var revokedAt = new DateTime(2026, 6, 28, 9, 0, 0, DateTimeKind.Utc);

        token.Revoke(revokedAt, "manual");

        token.RevokedAtUtc.Should().Be(revokedAt);
        token.RevocationReason.Should().Be("manual");
        token.IsRevoked.Should().BeTrue();
    }

    [Fact]
    public void Revoke_without_reason_defaults_to_revoked()
    {
        var token = BuildToken();
        var revokedAt = new DateTime(2026, 6, 28, 9, 0, 0, DateTimeKind.Utc);

        token.Revoke(revokedAt);

        token.RevocationReason.Should().Be("revoked");
    }

    // Test 8 — MarkRotated sets RevokedAtUtc, RevocationReason="rotated", and ReplacedByTokenId.
    [Fact]
    public void MarkRotated_sets_revocation_fields_and_ReplacedByTokenId()
    {
        var token = BuildToken();
        var rotatedAt = new DateTime(2026, 6, 28, 10, 0, 0, DateTimeKind.Utc);
        var replacementId = Guid.NewGuid();

        token.MarkRotated(rotatedAt, replacementId);

        token.RevokedAtUtc.Should().Be(rotatedAt);
        token.RevocationReason.Should().Be("rotated");
        token.ReplacedByTokenId.Should().Be(replacementId);
        token.IsRevoked.Should().BeTrue();
    }
}
