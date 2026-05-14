using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

/// <summary>
/// DATA_PRINCIPLE_SPINE_2026-05-05 Sub-phase 01.3 — entity wiring tests
/// for <see cref="DailyLog"/>. Verifies that the Phase 01 <see cref="Provenance"/>
/// value object is stamped on every row at factory time (defaulting to
/// the founder-locked "Manual('unknown')" fallback when callers omit it,
/// preserved verbatim when an explicit provenance is supplied) and that
/// the <c>SourceAiJobId</c> back-reference round-trips.
///
/// These tests are intentionally derived from the spec only — never from
/// the implementor's diff.
/// </summary>
public sealed class DailyLogProvenanceTests
{
    private static readonly FarmId AnyFarmId = new(Guid.Parse("11111111-1111-1111-1111-111111111111"));
    private static readonly Guid AnyPlotId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid AnyCropCycleId = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly UserId AnyOperatorUserId = new(Guid.Parse("44444444-4444-4444-4444-444444444444"));
    private static readonly DateOnly AnyLogDate = new(2026, 5, 14);
    private static readonly DateTime AnyCreatedAtUtc = new(2026, 5, 14, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void DailyLog_Create_with_null_provenance_defaults_to_Manual_unknown()
    {
        var log = DailyLog.Create(
            id: Guid.NewGuid(),
            farmId: AnyFarmId,
            plotId: AnyPlotId,
            cropCycleId: AnyCropCycleId,
            operatorUserId: AnyOperatorUserId,
            logDate: AnyLogDate,
            idempotencyKey: null,
            location: null,
            createdAtUtc: AnyCreatedAtUtc,
            provenance: null,
            sourceAiJobId: null);

        log.Provenance.Should().NotBeNull();
        log.Provenance.Source.Should().Be(Source.Manual);
        log.Provenance.AppVersion.Should().Be("unknown");
    }

    [Fact]
    public void DailyLog_Create_with_explicit_voice_provenance_preserves_it()
    {
        var explicitProvenance = new Provenance(
            source: Source.Voice,
            modelVersion: "gemini-2.5-flash",
            promptVersion: "v3.2.0",
            promptContentHash: "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc1",
            appVersion: "1.0.0");

        var log = DailyLog.Create(
            id: Guid.NewGuid(),
            farmId: AnyFarmId,
            plotId: AnyPlotId,
            cropCycleId: AnyCropCycleId,
            operatorUserId: AnyOperatorUserId,
            logDate: AnyLogDate,
            idempotencyKey: null,
            location: null,
            createdAtUtc: AnyCreatedAtUtc,
            provenance: explicitProvenance,
            sourceAiJobId: null);

        log.Provenance.Should().NotBeNull();
        log.Provenance.Source.Should().Be(Source.Voice);
        log.Provenance.ModelVersion.Should().Be("gemini-2.5-flash");
        log.Provenance.PromptVersion.Should().Be("v3.2.0");
        log.Provenance.PromptContentHash.Should().Be("abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc1");
        log.Provenance.AppVersion.Should().Be("1.0.0");
    }

    [Fact]
    public void DailyLog_Create_omitting_provenance_defaults_to_Manual_unknown()
    {
        // No `provenance:` argument — exercises the optional-parameter default.
        var log = DailyLog.Create(
            id: Guid.NewGuid(),
            farmId: AnyFarmId,
            plotId: AnyPlotId,
            cropCycleId: AnyCropCycleId,
            operatorUserId: AnyOperatorUserId,
            logDate: AnyLogDate,
            idempotencyKey: null,
            location: null,
            createdAtUtc: AnyCreatedAtUtc);

        log.Provenance.Should().NotBeNull();
        log.Provenance.Source.Should().Be(Source.Manual);
        log.Provenance.AppVersion.Should().Be("unknown");
    }

    [Fact]
    public void DailyLog_SourceAiJobId_defaults_to_null()
    {
        var log = DailyLog.Create(
            id: Guid.NewGuid(),
            farmId: AnyFarmId,
            plotId: AnyPlotId,
            cropCycleId: AnyCropCycleId,
            operatorUserId: AnyOperatorUserId,
            logDate: AnyLogDate,
            idempotencyKey: null,
            location: null,
            createdAtUtc: AnyCreatedAtUtc);

        log.SourceAiJobId.Should().BeNull();
    }

    [Fact]
    public void DailyLog_SourceAiJobId_round_trips_when_provided()
    {
        var aiJobId = Guid.Parse("99999999-9999-9999-9999-999999999999");

        var log = DailyLog.Create(
            id: Guid.NewGuid(),
            farmId: AnyFarmId,
            plotId: AnyPlotId,
            cropCycleId: AnyCropCycleId,
            operatorUserId: AnyOperatorUserId,
            logDate: AnyLogDate,
            idempotencyKey: null,
            location: null,
            createdAtUtc: AnyCreatedAtUtc,
            provenance: null,
            sourceAiJobId: aiJobId);

        log.SourceAiJobId.Should().Be(aiJobId);
    }
}
