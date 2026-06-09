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
    // gitleaks:allow — test constant, not a real secret. The 8df0e3 commit
    // tripped the generic-api-key rule on this literal because "Key" + dash-
    // separated alphanumeric matched the rule heuristic. The string is a
    // synthetic test idempotency token, never sent to a real provider.
    private const string AnyIdempotencyKey = "test-key-xxxxxx"; // gitleaks:allow

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

    // ─────────────────────────────────────────────────────────────────────
    // Codex cross-verification 2026-05-15 MAJOR-1 lock.
    // AiJob.AddAttempt(...) must hand the parent's Provenance down to
    // AiJobAttempt.Create so attempts don't silently fall back to
    // Provenance.Manual("unknown"). Each attempt's provenance is read
    // by audit reconstruction (Phase 04) and by the corpus writer
    // (Phase 09) — a Manual fallback there would lie about the source
    // of every retry.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void AddAttempt_inherits_parent_voice_provenance_not_Manual_fallback()
    {
        var voiceProvenance = new Provenance(
            source: Source.Voice,
            modelVersion: "gemini-2.0-flash",
            promptVersion: "v1",
            promptContentHash: "feedface".PadRight(64, '0'),
            appVersion: "1.2.3");

        var aiJob = AiJob.Create(
            id: AnyJobId,
            idempotencyKey: "idem-addattempt-voice",
            operationType: AiOperationType.VoiceToStructuredLog,
            userId: AnyUserId,
            farmId: AnyFarmId,
            inputContentHash: "abc",
            rawInputRef: null,
            inputSessionMetadataJson: null,
            provenance: voiceProvenance);

        var attempt = aiJob.AddAttempt(AiProviderType.Gemini, requestPayloadHash: "req-hash-1");

        attempt.Provenance.Source.Should().Be(Source.Voice,
            "AiJobAttempt must inherit the parent's Source, not the Manual fallback");
        attempt.Provenance.ModelVersion.Should().Be("gemini-2.0-flash");
        attempt.Provenance.PromptVersion.Should().Be("v1");
        attempt.Provenance.PromptContentHash.Should().Be("feedface".PadRight(64, '0'));
        attempt.Provenance.AppVersion.Should().Be("1.2.3");
    }

    [Fact]
    public void AddAttempt_inherits_parent_receipt_provenance()
    {
        var receiptProvenance = new Provenance(
            source: Source.ReceiptOcr,
            modelVersion: "unknown",
            promptVersion: "v1",
            promptContentHash: null,
            appVersion: "1.2.3");

        var aiJob = AiJob.Create(
            id: AnyJobId,
            idempotencyKey: "idem-addattempt-receipt",
            operationType: AiOperationType.ReceiptToExpenseItems,
            userId: AnyUserId,
            farmId: AnyFarmId,
            inputContentHash: null,
            rawInputRef: null,
            inputSessionMetadataJson: null,
            provenance: receiptProvenance);

        var attempt = aiJob.AddAttempt(AiProviderType.Gemini);

        attempt.Provenance.Source.Should().Be(Source.ReceiptOcr,
            "AiJobAttempt must inherit Source.ReceiptOcr from the parent receipt job");
        attempt.Provenance.AppVersion.Should().Be("1.2.3");
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2026-06-09 regression: the attempt must own a SEPARATE Provenance CLR
    // instance (identical values), NOT the parent job's instance. EF Core
    // owned types are per-owner; assigning the SAME instance to both the job
    // and its attempt makes EF persist NULL for the attempt's owned `source`
    // column on a real relational provider → Npgsql 23502 (NOT NULL violation
    // on ssf.ai_job_attempts.source), which 500'd the first voice-parse to
    // complete its write on prod. The InMemory provider used by the AI
    // endpoint tests does not enforce NOT NULL, so this was prod-only; this
    // unit test guards the distinct-reference requirement provider-agnostically.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public void AddAttempt_gives_attempt_a_distinct_provenance_instance_not_the_shared_parent_reference()
    {
        var parentProvenance = new Provenance(
            source: Source.Voice,
            modelVersion: "gemini-2.0-flash",
            promptVersion: "v1",
            promptContentHash: "feedface".PadRight(64, '0'),
            appVersion: "1.2.3");

        var aiJob = AiJob.Create(
            id: AnyJobId,
            idempotencyKey: "idem-addattempt-distinct",
            operationType: AiOperationType.VoiceToStructuredLog,
            userId: AnyUserId,
            farmId: AnyFarmId,
            inputContentHash: "abc",
            rawInputRef: null,
            inputSessionMetadataJson: null,
            provenance: parentProvenance);

        var attempt = aiJob.AddAttempt(AiProviderType.Gemini, requestPayloadHash: "req-hash-distinct");

        attempt.Provenance.Should().NotBeSameAs(aiJob.Provenance,
            "the attempt must own a distinct Provenance instance so EF persists its own owned `source` tuple (a shared instance → NULL source → Npgsql 23502 on ssf.ai_job_attempts)");
        attempt.Provenance.Source.Should().Be(aiJob.Provenance.Source, "lineage values must still match the parent");
        attempt.Provenance.ModelVersion.Should().Be(aiJob.Provenance.ModelVersion);
        attempt.Provenance.PromptVersion.Should().Be(aiJob.Provenance.PromptVersion);
    }
}
