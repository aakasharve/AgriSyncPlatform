using FluentAssertions;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Common;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

/// <summary>
/// DATA_PRINCIPLE_SPINE_2026-05-05 Sub-phase 01.3 — entity wiring tests
/// for <see cref="AiJobAttempt"/>. Every attempt row must carry a
/// non-null <see cref="Provenance"/>; the factory defaults to
/// "Manual('unknown')" when no provenance is supplied and preserves
/// explicit provenance verbatim.
///
/// Tests derived from the spec only.
/// </summary>
public sealed class AiJobAttemptProvenanceTests
{
    private static readonly Guid AnyAttemptId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid AnyAiJobId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private const int AnyAttemptNumber = 1;

    [Fact]
    public void AiJobAttempt_exposes_Provenance_property()
    {
        typeof(AiJobAttempt).GetProperty("Provenance").Should().NotBeNull(
            "AiJobAttempt rows must carry provenance per DATA_PRINCIPLE_SPINE Sub-phase 01.3.");
    }

    [Fact]
    public void AiJobAttempt_Create_with_null_provenance_defaults_to_Manual_unknown()
    {
        var attempt = AiJobAttempt.Create(
            id: AnyAttemptId,
            aiJobId: AnyAiJobId,
            attemptNumber: AnyAttemptNumber,
            provider: AiProviderType.Gemini,
            requestPayloadHash: null,
            provenance: null);

        attempt.Provenance.Should().NotBeNull();
        attempt.Provenance.Source.Should().Be(Source.Manual);
        attempt.Provenance.AppVersion.Should().Be("unknown");
    }

    [Fact]
    public void AiJobAttempt_Create_with_explicit_provenance_preserves_it()
    {
        var explicitProvenance = new Provenance(
            source: Source.Voice,
            modelVersion: "gemini-2.5-flash",
            promptVersion: "v3.2.0",
            promptContentHash: "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc1",
            appVersion: "1.0.0");

        var attempt = AiJobAttempt.Create(
            id: AnyAttemptId,
            aiJobId: AnyAiJobId,
            attemptNumber: AnyAttemptNumber,
            provider: AiProviderType.Gemini,
            requestPayloadHash: null,
            provenance: explicitProvenance);

        attempt.Provenance.Should().NotBeNull();
        attempt.Provenance.Source.Should().Be(Source.Voice);
        attempt.Provenance.ModelVersion.Should().Be("gemini-2.5-flash");
        attempt.Provenance.PromptVersion.Should().Be("v3.2.0");
        attempt.Provenance.PromptContentHash.Should().Be("abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc1");
        attempt.Provenance.AppVersion.Should().Be("1.0.0");
    }
}
