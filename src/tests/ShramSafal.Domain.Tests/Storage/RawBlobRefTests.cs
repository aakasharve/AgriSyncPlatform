using FluentAssertions;
using ShramSafal.Domain.Storage;
using Xunit;

namespace ShramSafal.Domain.Tests.Storage;

public class RawBlobRefTests
{
    [Fact]
    public void FromBytes_computes_sha256_lowercase_hex_and_builds_extensionless_s3_key()
    {
        var bytes = "hello"u8.ToArray();
        var r = RawBlobRef.FromBytes(bytes, contentType: "audio/opus");
        r.Sha256.Should().Be("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
        r.SizeBytes.Should().Be(5);
        // DATA_PRINCIPLE_SPINE 02-patch: S3 key is `raw/<sha256>` with no
        // extension. The extension was decorative and was dropped because
        // the PUT path used `raw/{sha}.{ext}` while GET / DereferenceAsync
        // used `raw/{sha}`, which silently broke retrieval.
        r.S3Key.Should().Be("raw/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
        r.ContentType.Should().Be("audio/opus");
    }

    [Fact]
    public void FromBytes_preserves_content_type_for_unknown_mime()
    {
        // The 02-patch contract: extension is gone from the key, but the
        // original content type lives on `ContentType` (and is stamped on
        // S3 object metadata + `raw_blob_index.content_type`), so an
        // unknown MIME is round-trippable through the ref itself.
        var r = RawBlobRef.FromBytes("x"u8.ToArray(), contentType: "application/x-unknown");
        r.ContentType.Should().Be("application/x-unknown");
        r.S3Key.Should().Be("raw/2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881");
        r.S3Key.Should().NotContain(".");
    }

    [Fact]
    public void FromBytes_is_content_addressed_identical_bytes_produce_identical_key_regardless_of_mime()
    {
        // Two callers handing in the same bytes with different MIMEs must
        // land at the same S3 key — the key is bytes-only. Phase 02's
        // dedup story relies on this invariant.
        var a = RawBlobRef.FromBytes("abc"u8.ToArray(), contentType: "audio/opus");
        var b = RawBlobRef.FromBytes("abc"u8.ToArray(), contentType: "image/jpeg");

        a.S3Key.Should().Be(b.S3Key);
        a.Sha256.Should().Be(b.Sha256);
    }
}
