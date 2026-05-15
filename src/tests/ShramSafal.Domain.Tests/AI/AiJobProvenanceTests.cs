using FluentAssertions;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Common;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

/// <summary>
/// DATA_PRINCIPLE_SPINE_2026-05-05 Sub-phase 01.3 — entity wiring tests
/// for <see cref="AiJob"/>. Locks three guarantees:
/// <list type="number">
/// <item>The legacy <c>InputStoragePath</c> property name is gone and the
/// canonical name is <c>RawInputRef</c> (reflection assertion — guards
/// against accidental re-introduction).</item>
/// <item>The factory defaults to "Manual('unknown')" when no provenance
/// is supplied and preserves explicit provenance verbatim.</item>
/// <item><c>RawInputRef</c> round-trips through the factory.</item>
/// </list>
///
/// Tests derived from the spec only.
/// </summary>
public sealed class AiJobProvenanceTests
{
    private static readonly Guid AnyJobId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid AnyUserId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid AnyFarmId = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private const string AnyIdempotencyKey = "idemp-abc-123";

    [Fact]
    public void AiJob_exposes_RawInputRef_property()
    {
        // Spec lock: RawInputRef is canonical, legacy InputStoragePath must not exist.
        typeof(AiJob).GetProperty("RawInputRef").Should().NotBeNull(
            "RawInputRef is the canonical property name per DATA_PRINCIPLE_SPINE Sub-phase 01.3.");
        typeof(AiJob).GetProperty("InputStoragePath").Should().BeNull(
            "InputStoragePath is the legacy name and must not be re-introduced.");
    }

    [Fact]
    public void AiJob_Create_with_null_provenance_defaults_to_Manual_unknown()
    {
        var job = AiJob.Create(
            id: AnyJobId,
            idempotencyKey: AnyIdempotencyKey,
            operationType: AiOperationType.VoiceToStructuredLog,
            userId: AnyUserId,
            farmId: AnyFarmId,
            inputContentHash: null,
            rawInputRef: null,
            inputSessionMetadataJson: null,
            provenance: null);

        job.Provenance.Should().NotBeNull();
        job.Provenance.Source.Should().Be(Source.Manual);
        job.Provenance.AppVersion.Should().Be("unknown");
    }

    [Fact]
    public void AiJob_Create_with_explicit_provenance_preserves_it()
    {
        var explicitProvenance = new Provenance(
            source: Source.Voice,
            modelVersion: "gemini-2.5-flash",
            promptVersion: "v3.2.0",
            promptContentHash: "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc1",
            appVersion: "1.0.0");

        var job = AiJob.Create(
            id: AnyJobId,
            idempotencyKey: AnyIdempotencyKey,
            operationType: AiOperationType.VoiceToStructuredLog,
            userId: AnyUserId,
            farmId: AnyFarmId,
            inputContentHash: null,
            rawInputRef: null,
            inputSessionMetadataJson: null,
            provenance: explicitProvenance);

        job.Provenance.Should().NotBeNull();
        job.Provenance.Source.Should().Be(Source.Voice);
        job.Provenance.ModelVersion.Should().Be("gemini-2.5-flash");
        job.Provenance.PromptVersion.Should().Be("v3.2.0");
        job.Provenance.PromptContentHash.Should().Be("abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc1");
        job.Provenance.AppVersion.Should().Be("1.0.0");
    }

    [Fact]
    public void AiJob_Create_with_explicit_rawInputRef_preserves_it()
    {
        const string rawInputRef = "s3://agrisync-ai-raw-inputs/2026/05/14/abc.webm";

        var job = AiJob.Create(
            id: AnyJobId,
            idempotencyKey: AnyIdempotencyKey,
            operationType: AiOperationType.VoiceToStructuredLog,
            userId: AnyUserId,
            farmId: AnyFarmId,
            inputContentHash: null,
            rawInputRef: rawInputRef,
            inputSessionMetadataJson: null,
            provenance: null);

        job.RawInputRef.Should().Be(rawInputRef);
    }

    [Fact]
    public void UpdateProvenance_replaces_model_version_only_and_stamps_ModifiedAtUtc()
    {
        var aiJob = AiJob.Create(
            id: AnyJobId,
            idempotencyKey: "test-key",
            operationType: AiOperationType.VoiceToStructuredLog,
            userId: AnyUserId,
            farmId: AnyFarmId,
            inputContentHash: "abc",
            rawInputRef: null,
            inputSessionMetadataJson: null,
            provenance: new Provenance(
                source: Source.Voice,
                modelVersion: "unknown",
                promptVersion: "v1",
                promptContentHash: "deadbeef".PadRight(64, '0'),
                appVersion: "1.2.3"));

        var before = aiJob.ModifiedAtUtc;
        System.Threading.Thread.Sleep(2);   // ensure ModifiedAtUtc advances

        aiJob.UpdateProvenance("gemini-2.0-flash");

        aiJob.Provenance.ModelVersion.Should().Be("gemini-2.0-flash");
        aiJob.Provenance.Source.Should().Be(Source.Voice);
        aiJob.Provenance.PromptVersion.Should().Be("v1");
        aiJob.Provenance.PromptContentHash.Should().Be("deadbeef".PadRight(64, '0'));
        aiJob.Provenance.AppVersion.Should().Be("1.2.3");
        aiJob.ModifiedAtUtc.Should().BeAfter(before);
    }

    [Fact]
    public void UpdateProvenance_rejects_empty_modelVersion()
    {
        var aiJob = AiJob.Create(
            id: AnyJobId,
            idempotencyKey: "test-key-2",
            operationType: AiOperationType.VoiceToStructuredLog,
            userId: AnyUserId,
            farmId: AnyFarmId,
            inputContentHash: "abc",
            rawInputRef: null,
            inputSessionMetadataJson: null,
            provenance: Provenance.Manual("1.0.0"));

        var act = () => aiJob.UpdateProvenance("   ");
        act.Should().Throw<ArgumentException>().WithMessage("*modelVersion*");
    }
}
