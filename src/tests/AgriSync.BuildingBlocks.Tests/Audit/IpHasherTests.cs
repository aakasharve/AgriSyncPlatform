using System.Text;
using AgriSync.BuildingBlocks.Audit;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Audit;

/// <summary>
/// Pins the §04.2.2 invariants for <see cref="IpHasher"/>: salt-length
/// guard, null/whitespace sentinel, determinism, salt influence, and
/// output shape (sha256:<64 hex chars>). These are the contracts every
/// audit-row writer in Phase 04.3b will rely on; any drift here would
/// silently corrupt the ip_hash column.
/// </summary>
public sealed class IpHasherTests
{
    private static byte[] ValidSalt(string seed = "agrisync_audit_test_salt_2026__padding") =>
        Encoding.UTF8.GetBytes(seed);

    [Fact]
    public void Hash_with_short_salt_throws_in_ctor()
    {
        // 15 bytes — one short of the >=16 minimum.
        var shortSalt = new byte[15];

        var act = () => new IpHasher(shortSalt);

        var ex = Assert.Throws<ArgumentException>(act);
        Assert.Equal("salt", ex.ParamName);
    }

    [Fact]
    public void Hash_with_null_salt_throws_in_ctor()
    {
        var act = () => new IpHasher(null!);

        var ex = Assert.Throws<ArgumentException>(act);
        Assert.Equal("salt", ex.ParamName);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\t")]
    public void Hash_null_or_whitespace_ip_returns_sha256_unknown_sentinel(string? ip)
    {
        var hasher = new IpHasher(ValidSalt());

        var result = hasher.Hash(ip);

        Assert.Equal("sha256:unknown", result);
    }

    [Fact]
    public void Hash_same_ip_same_salt_returns_same_hash()
    {
        // Determinism is required for forensic correlation: two audit
        // rows from the same caller must collide on ip_hash.
        var salt = ValidSalt();
        var hasherA = new IpHasher(salt);
        var hasherB = new IpHasher(salt);

        var a = hasherA.Hash("203.0.113.42");
        var b = hasherB.Hash("203.0.113.42");

        Assert.Equal(a, b);
    }

    [Fact]
    public void Hash_same_ip_different_salt_returns_different_hash()
    {
        // Salt influence — yearly rotation invalidates cross-epoch
        // correlation, which is the documented forensic boundary.
        var hasherA = new IpHasher(ValidSalt("epoch_2025_salt_must_be_long_enough_xx"));
        var hasherB = new IpHasher(ValidSalt("epoch_2026_salt_must_be_long_enough_xx"));

        var a = hasherA.Hash("203.0.113.42");
        var b = hasherB.Hash("203.0.113.42");

        Assert.NotEqual(a, b);
    }

    [Fact]
    public void Hash_output_is_sha256_prefix_plus_64_hex()
    {
        var hasher = new IpHasher(ValidSalt());

        var result = hasher.Hash("203.0.113.42");

        Assert.StartsWith("sha256:", result);
        var hex = result["sha256:".Length..];
        Assert.Equal(64, hex.Length);
        Assert.All(hex, c => Assert.True(
            (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'),
            $"non-lowercase-hex character '{c}' in {result}"));
    }
}
