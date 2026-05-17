// spec: voice-diary-e2e-2026-05-17 (B.16)
using FluentAssertions;
using ShramSafal.Domain.Privacy;
using Xunit;

namespace ShramSafal.Domain.Tests.Privacy;

/// <summary>
/// Wave 1.B — Voice Diary domain tests. Locks the factory invariants
/// and the deterministic S3 key shape the Infrastructure adapter
/// relies on.
/// </summary>
public sealed class VoiceClipRetainedTests
{
    private static readonly DateTime FixedNow =
        new(2026, 5, 17, 12, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime FixedRecordedAt =
        new(2026, 5, 17, 11, 30, 0, DateTimeKind.Utc);

    private static readonly Guid SampleClipId =
        Guid.Parse("11111111-2222-3333-4444-555555555555");
    private static readonly Guid SampleUserId =
        Guid.Parse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");

    [Fact]
    public void Create_with_valid_inputs_returns_populated_aggregate()
    {
        var clip = VoiceClipRetained.Create(
            clipId: SampleClipId,
            userId: SampleUserId,
            recordedAtUtc: FixedRecordedAt,
            s3Key: VoiceClipRetained.BuildS3Key(SampleUserId, SampleClipId),
            dekId: "dek-2026-05-17",
            ivBase64: "AAECAwQFBgcICQoLDA0ODw==",
            authTagBase64: "EBESExQVFhcYGRobHB0eHw==",
            durationSeconds: 12,
            language: "mr-IN",
            consentAuditId: null,
            nowUtc: FixedNow);

        clip.ClipId.Should().Be(SampleClipId);
        clip.UserId.Should().Be(SampleUserId);
        clip.RecordedAtUtc.Should().Be(FixedRecordedAt);
        clip.S3Key.Should().Be($"retained/{SampleUserId:D}/{SampleClipId:D}.bin");
        clip.DekId.Should().Be("dek-2026-05-17");
        clip.IvBase64.Should().Be("AAECAwQFBgcICQoLDA0ODw==");
        clip.AuthTagBase64.Should().Be("EBESExQVFhcYGRobHB0eHw==");
        clip.DurationSeconds.Should().Be(12);
        clip.Language.Should().Be("mr-IN");
        clip.ConsentAuditId.Should().BeNull();
        clip.CreatedAtUtc.Should().Be(FixedNow);
    }

    [Fact]
    public void BuildS3Key_is_deterministic_for_same_user_and_clip()
    {
        var key1 = VoiceClipRetained.BuildS3Key(SampleUserId, SampleClipId);
        var key2 = VoiceClipRetained.BuildS3Key(SampleUserId, SampleClipId);
        key1.Should().Be(key2);
        key1.Should().StartWith("retained/");
        key1.Should().EndWith(".bin");
    }

    [Theory]
    [InlineData("clipId")]
    [InlineData("userId")]
    public void Create_rejects_empty_id_for(string fieldName)
    {
        var clipId = fieldName == "clipId" ? Guid.Empty : SampleClipId;
        var userId = fieldName == "userId" ? Guid.Empty : SampleUserId;

        Action act = () => VoiceClipRetained.Create(
            clipId: clipId,
            userId: userId,
            recordedAtUtc: FixedRecordedAt,
            s3Key: "retained/x/y.bin",
            dekId: "dek",
            ivBase64: "iv",
            authTagBase64: "tag",
            durationSeconds: 3,
            language: "mr-IN",
            consentAuditId: null,
            nowUtc: FixedNow);

        act.Should().Throw<ArgumentException>()
            .Where(e => e.ParamName == fieldName);
    }

    [Fact]
    public void Create_rejects_non_utc_recorded_at()
    {
        var localKind = DateTime.SpecifyKind(FixedRecordedAt, DateTimeKind.Local);
        Action act = () => VoiceClipRetained.Create(
            clipId: SampleClipId,
            userId: SampleUserId,
            recordedAtUtc: localKind,
            s3Key: "retained/x/y.bin",
            dekId: "dek",
            ivBase64: "iv",
            authTagBase64: "tag",
            durationSeconds: 3,
            language: "mr-IN",
            consentAuditId: null,
            nowUtc: FixedNow);

        act.Should().Throw<ArgumentException>()
            .Where(e => e.ParamName == "recordedAtUtc");
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Create_rejects_non_positive_duration(int durationSeconds)
    {
        Action act = () => VoiceClipRetained.Create(
            clipId: SampleClipId,
            userId: SampleUserId,
            recordedAtUtc: FixedRecordedAt,
            s3Key: "retained/x/y.bin",
            dekId: "dek",
            ivBase64: "iv",
            authTagBase64: "tag",
            durationSeconds: durationSeconds,
            language: "mr-IN",
            consentAuditId: null,
            nowUtc: FixedNow);

        act.Should().Throw<ArgumentOutOfRangeException>()
            .Where(e => e.ParamName == "durationSeconds");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Create_rejects_blank_language(string language)
    {
        Action act = () => VoiceClipRetained.Create(
            clipId: SampleClipId,
            userId: SampleUserId,
            recordedAtUtc: FixedRecordedAt,
            s3Key: "retained/x/y.bin",
            dekId: "dek",
            ivBase64: "iv",
            authTagBase64: "tag",
            durationSeconds: 3,
            language: language,
            consentAuditId: null,
            nowUtc: FixedNow);

        act.Should().Throw<ArgumentException>()
            .Where(e => e.ParamName == "language");
    }

    [Fact]
    public void Create_rejects_empty_consent_audit_id_when_supplied()
    {
        Action act = () => VoiceClipRetained.Create(
            clipId: SampleClipId,
            userId: SampleUserId,
            recordedAtUtc: FixedRecordedAt,
            s3Key: "retained/x/y.bin",
            dekId: "dek",
            ivBase64: "iv",
            authTagBase64: "tag",
            durationSeconds: 3,
            language: "mr-IN",
            consentAuditId: Guid.Empty,
            nowUtc: FixedNow);

        act.Should().Throw<ArgumentException>()
            .Where(e => e.ParamName == "consentAuditId");
    }

    [Theory]
    [InlineData("s3Key", "")]
    [InlineData("dekId", "")]
    [InlineData("ivBase64", "")]
    [InlineData("authTagBase64", "")]
    public void Create_rejects_blank_envelope_field(string fieldName, string blank)
    {
        Action act = () => VoiceClipRetained.Create(
            clipId: SampleClipId,
            userId: SampleUserId,
            recordedAtUtc: FixedRecordedAt,
            s3Key: fieldName == "s3Key" ? blank : "retained/x/y.bin",
            dekId: fieldName == "dekId" ? blank : "dek",
            ivBase64: fieldName == "ivBase64" ? blank : "iv",
            authTagBase64: fieldName == "authTagBase64" ? blank : "tag",
            durationSeconds: 3,
            language: "mr-IN",
            consentAuditId: null,
            nowUtc: FixedNow);

        act.Should().Throw<ArgumentException>()
            .Where(e => e.ParamName == fieldName);
    }
}
