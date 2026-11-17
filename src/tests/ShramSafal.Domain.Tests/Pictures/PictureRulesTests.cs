// spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-S; founder D-146)
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Domain.Pictures;
using Xunit;

namespace ShramSafal.Domain.Tests.Pictures;

/// <summary>The file rules: type by the FIRST BYTES, never a name; no SVG, no PDF; the cap; the storage key; the row's own checks.</summary>
public sealed class PictureRulesTests
{
    [Fact]
    public void A_jpeg_a_png_and_a_webp_are_known_by_their_first_bytes()
    {
        PictureRules.DetectContentType(PictureTestKit.Jpeg()).Should().Be("image/jpeg");
        PictureRules.DetectContentType(PictureTestKit.Png()).Should().Be("image/png");
        PictureRules.DetectContentType(PictureTestKit.Webp()).Should().Be("image/webp");
    }

    [Fact]
    public void Svg_pdf_html_and_plain_text_are_not_pictures()
    {
        // SVG can carry script; a PDF can carry links: both are refused whatever they are called.
        PictureRules.DetectContentType("<svg xmlns='http://www.w3.org/2000/svg'></svg>"u8).Should().BeNull();
        PictureRules.DetectContentType("<?xml version='1.0'?><svg/>"u8).Should().BeNull();
        PictureRules.DetectContentType("%PDF-1.7 ..."u8).Should().BeNull();
        PictureRules.DetectContentType("<html><body>x</body></html>"u8).Should().BeNull();
        PictureRules.DetectContentType("GIF89a......"u8).Should().BeNull();
    }

    [Fact]
    public void An_empty_or_too_short_head_is_not_a_picture()
    {
        PictureRules.DetectContentType([]).Should().BeNull();
        PictureRules.DetectContentType([0xFF, 0xD8]).Should().BeNull();
        PictureRules.DetectContentType([0x89, 0x50, 0x4E, 0x47]).Should().BeNull();
        // "RIFF" alone is a wav or an avi, not a webp
        PictureRules.DetectContentType("RIFF....WAVE"u8).Should().BeNull();
        PictureRules.DetectContentType("RIFF"u8).Should().BeNull();
    }

    [Fact]
    public void The_type_comes_from_the_bytes_so_a_png_called_jpg_is_still_a_png()
    {
        // there is no name or declared type in the rule at all: the detector takes bytes only
        PictureRules.DetectContentType(PictureTestKit.Png()).Should().Be(PictureRules.Png);
    }

    [Fact]
    public void The_cap_is_512_KB_and_the_normal_size_the_phone_aims_at_is_256_KB()
    {
        PictureRules.MaxBytes.Should().Be(512 * 1024);
        PictureRules.NormalBytes.Should().Be(256 * 1024);
    }

    [Fact]
    public void The_storage_key_is_kind_subject_and_hash_under_the_pictures_prefix()
    {
        var subject = Guid.Parse("0f0e0d0c-0b0a-0908-0706-050403020100");
        var sha = new string('a', 64);

        PictureRules.StorageKeyFor(PictureKind.Person, subject, sha).Should().Be($"pictures/person/0f0e0d0c0b0a09080706050403020100/{sha}.webp");
        PictureRules.StorageKeyFor(PictureKind.Schedule, subject, sha).Should().StartWith("pictures/schedule/");
        PictureRules.StorageKeyFor(PictureKind.Institution, subject, sha).Should().StartWith("pictures/institution/");
    }

    [Fact]
    public void The_hash_is_lower_case_hex_sha256()
    {
        PictureRules.Sha256Hex("abc"u8).Should().Be("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    [Fact]
    public void The_wire_words_round_trip_and_unknown_words_are_refused()
    {
        foreach (var kind in Enum.GetValues<PictureKind>())
        {
            PictureKinds.TryParse(PictureKinds.ToWire(kind), out var back).Should().BeTrue();
            back.Should().Be(kind);
        }

        PictureKinds.TryParse("person", out _).Should().BeFalse("the words are ours and case-exact");
        PictureKinds.TryParse("TEAM", out _).Should().BeFalse();
        PictureKinds.TryParse(null, out _).Should().BeFalse();
    }

    [Fact]
    public void A_row_refuses_a_bad_hash_type_size_subject_or_setter()
    {
        var bytes = PictureTestKit.Jpeg();
        var sha = PictureRules.Sha256Hex(bytes);
        var me = new UserId(Guid.NewGuid());

        var ok = Picture.Create(Guid.NewGuid(), PictureKind.Person, me.Value, PictureRules.Jpeg, bytes.Length, sha, me, PictureTestKit.Now);
        ok.StorageKey.Should().Be(PictureRules.StorageKeyFor(PictureKind.Person, me.Value, sha));

        var bad = new[]
        {
            () => Picture.Create(Guid.Empty, PictureKind.Person, me.Value, PictureRules.Jpeg, 10, sha, me, PictureTestKit.Now),
            () => Picture.Create(Guid.NewGuid(), PictureKind.Person, Guid.Empty, PictureRules.Jpeg, 10, sha, me, PictureTestKit.Now),
            () => Picture.Create(Guid.NewGuid(), PictureKind.Person, me.Value, "image/svg+xml", 10, sha, me, PictureTestKit.Now),
            () => Picture.Create(Guid.NewGuid(), PictureKind.Person, me.Value, PictureRules.Jpeg, 0, sha, me, PictureTestKit.Now),
            () => Picture.Create(Guid.NewGuid(), PictureKind.Person, me.Value, PictureRules.Jpeg, PictureRules.MaxBytes + 1, sha, me, PictureTestKit.Now),
            () => Picture.Create(Guid.NewGuid(), PictureKind.Person, me.Value, PictureRules.Jpeg, 10, "ABC", me, PictureTestKit.Now),
            () => Picture.Create(Guid.NewGuid(), PictureKind.Person, me.Value, PictureRules.Jpeg, 10, new string('A', 64), me, PictureTestKit.Now),
            () => Picture.Create(Guid.NewGuid(), PictureKind.Person, me.Value, PictureRules.Jpeg, 10, sha, default, PictureTestKit.Now),
        };
        foreach (var make in bad)
        {
            make.Should().Throw<ArgumentException>();
        }
    }

    [Fact]
    public void Replacing_points_the_row_at_the_new_file_and_keeps_its_identity()
    {
        var me = new UserId(Guid.NewGuid());
        var first = PictureTestKit.Jpeg(64, 1);
        var second = PictureTestKit.Png(80, 2);
        var row = Picture.Create(Guid.NewGuid(), PictureKind.Person, me.Value, PictureRules.Jpeg, first.Length, PictureRules.Sha256Hex(first), me, PictureTestKit.Now);
        var id = row.Id;
        var oldKey = row.StorageKey;

        row.Replace(PictureRules.Png, second.Length, PictureRules.Sha256Hex(second), me, PictureTestKit.Now.AddMinutes(5));

        row.Id.Should().Be(id);
        row.SubjectId.Should().Be(me.Value);
        row.Kind.Should().Be(PictureKind.Person);
        row.StorageKey.Should().NotBe(oldKey);
        row.ContentType.Should().Be(PictureRules.Png);
        row.SetAtUtc.Should().Be(PictureTestKit.Now.AddMinutes(5));
    }
}
