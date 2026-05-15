using FluentAssertions;
using ShramSafal.Domain.Storage;
using Xunit;

namespace ShramSafal.Domain.Tests.Storage;

public class RawBlobRefTests
{
    [Fact]
    public void FromBytes_computes_sha256_lowercase_hex()
    {
        var bytes = "hello"u8.ToArray();
        var r = RawBlobRef.FromBytes(bytes, contentType: "audio/opus");
        r.Sha256.Should().Be("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
        r.SizeBytes.Should().Be(5);
        r.S3Key.Should().Be("raw/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824.opus");
    }

    [Fact]
    public void S3Key_extension_falls_back_to_bin_for_unknown_content_type()
    {
        var r = RawBlobRef.FromBytes("x"u8.ToArray(), contentType: "application/x-unknown");
        r.S3Key.Should().EndWith(".bin");
    }
}
