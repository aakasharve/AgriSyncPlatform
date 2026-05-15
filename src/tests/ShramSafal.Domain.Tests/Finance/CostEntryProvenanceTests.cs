using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Finance;
using Xunit;

namespace ShramSafal.Domain.Tests.Finance;

/// <summary>
/// DATA_PRINCIPLE_SPINE_2026-05-05 Sub-phase 01.3 — entity wiring tests
/// for <see cref="CostEntry"/>. Both factories (<see cref="CostEntry.Create"/>
/// and <see cref="CostEntry.CreateLabourPayout"/>) must accept an optional
/// <see cref="Provenance"/>, default to the founder-locked
/// "Manual('unknown')" fallback when the caller passes <c>null</c>, and
/// preserve an explicit provenance verbatim. <c>SourceAiJobId</c> must
/// round-trip.
///
/// Tests are derived from the spec alone — never from the implementor's diff.
/// </summary>
public sealed class CostEntryProvenanceTests
{
    private static readonly FarmId AnyFarmId = new(Guid.Parse("11111111-1111-1111-1111-111111111111"));
    private static readonly UserId AnyCreatedByUserId = new(Guid.Parse("22222222-2222-2222-2222-222222222222"));
    private static readonly DateOnly AnyEntryDate = new(2026, 5, 14);
    private static readonly DateTime AnyCreatedAtUtc = new(2026, 5, 14, 12, 0, 0, DateTimeKind.Utc);
    // DATA_PRINCIPLE_SPINE sub-phase 02.5 — the free-text legacy fixture
    // `"input"` is no longer valid; the canonical code list is the only
    // source of truth. `seeds` is a generic non-payout choice that
    // satisfies CostEntry.Create's CEI-I8 guard.
    private const string AnyCategory = "seeds";
    private const string AnyDescription = "Urea purchase";
    private const decimal AnyAmount = 1234.56m;
    private const string AnyCurrency = "INR";

    private static Provenance MakeExplicitReceiptOcrProvenance() =>
        new(
            source: Source.ReceiptOcr,
            modelVersion: "gemini-2.5-flash",
            promptVersion: "v3.2.0",
            promptContentHash: "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc1",
            appVersion: "1.0.0");

    [Fact]
    public void CostEntry_Create_with_null_provenance_defaults_to_Manual_unknown()
    {
        var entry = CostEntry.Create(
            id: Guid.NewGuid(),
            farmId: AnyFarmId,
            plotId: null,
            cropCycleId: null,
            categoryId: AnyCategory,
            description: AnyDescription,
            amount: AnyAmount,
            currencyCode: AnyCurrency,
            entryDate: AnyEntryDate,
            createdByUserId: AnyCreatedByUserId,
            location: null,
            createdAtUtc: AnyCreatedAtUtc,
            provenance: null,
            sourceAiJobId: null);

        entry.Provenance.Should().NotBeNull();
        entry.Provenance.Source.Should().Be(Source.Manual);
        entry.Provenance.AppVersion.Should().Be("unknown");
    }

    [Fact]
    public void CostEntry_Create_with_explicit_provenance_preserves_it()
    {
        var explicitProvenance = MakeExplicitReceiptOcrProvenance();

        var entry = CostEntry.Create(
            id: Guid.NewGuid(),
            farmId: AnyFarmId,
            plotId: null,
            cropCycleId: null,
            categoryId: AnyCategory,
            description: AnyDescription,
            amount: AnyAmount,
            currencyCode: AnyCurrency,
            entryDate: AnyEntryDate,
            createdByUserId: AnyCreatedByUserId,
            location: null,
            createdAtUtc: AnyCreatedAtUtc,
            provenance: explicitProvenance,
            sourceAiJobId: null);

        entry.Provenance.Should().NotBeNull();
        entry.Provenance.Source.Should().Be(Source.ReceiptOcr);
        entry.Provenance.ModelVersion.Should().Be("gemini-2.5-flash");
        entry.Provenance.PromptVersion.Should().Be("v3.2.0");
        entry.Provenance.PromptContentHash.Should().Be("abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc1");
        entry.Provenance.AppVersion.Should().Be("1.0.0");
    }

    [Fact]
    public void CostEntry_CreateLabourPayout_with_null_provenance_defaults_to_Manual_unknown()
    {
        var entry = CostEntry.CreateLabourPayout(
            id: Guid.NewGuid(),
            jobCardId: Guid.Parse("55555555-5555-5555-5555-555555555555"),
            farmId: AnyFarmId,
            plotId: null,
            cropCycleId: null,
            amount: AnyAmount,
            currencyCode: AnyCurrency,
            entryDate: AnyEntryDate,
            createdByUserId: AnyCreatedByUserId,
            createdAtUtc: AnyCreatedAtUtc,
            provenance: null,
            sourceAiJobId: null);

        entry.Provenance.Should().NotBeNull();
        entry.Provenance.Source.Should().Be(Source.Manual);
        entry.Provenance.AppVersion.Should().Be("unknown");
    }

    [Fact]
    public void CostEntry_CreateLabourPayout_with_explicit_provenance_preserves_it()
    {
        var explicitProvenance = MakeExplicitReceiptOcrProvenance();

        var entry = CostEntry.CreateLabourPayout(
            id: Guid.NewGuid(),
            jobCardId: Guid.Parse("55555555-5555-5555-5555-555555555555"),
            farmId: AnyFarmId,
            plotId: null,
            cropCycleId: null,
            amount: AnyAmount,
            currencyCode: AnyCurrency,
            entryDate: AnyEntryDate,
            createdByUserId: AnyCreatedByUserId,
            createdAtUtc: AnyCreatedAtUtc,
            provenance: explicitProvenance,
            sourceAiJobId: null);

        entry.Provenance.Should().NotBeNull();
        entry.Provenance.Source.Should().Be(Source.ReceiptOcr);
        entry.Provenance.ModelVersion.Should().Be("gemini-2.5-flash");
        entry.Provenance.PromptVersion.Should().Be("v3.2.0");
        entry.Provenance.PromptContentHash.Should().Be("abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc1");
        entry.Provenance.AppVersion.Should().Be("1.0.0");
    }

    [Fact]
    public void CostEntry_SourceAiJobId_round_trips_when_provided()
    {
        var aiJobId = Guid.Parse("99999999-9999-9999-9999-999999999999");

        var entry = CostEntry.Create(
            id: Guid.NewGuid(),
            farmId: AnyFarmId,
            plotId: null,
            cropCycleId: null,
            categoryId: AnyCategory,
            description: AnyDescription,
            amount: AnyAmount,
            currencyCode: AnyCurrency,
            entryDate: AnyEntryDate,
            createdByUserId: AnyCreatedByUserId,
            location: null,
            createdAtUtc: AnyCreatedAtUtc,
            provenance: null,
            sourceAiJobId: aiJobId);

        entry.SourceAiJobId.Should().Be(aiJobId);
    }
}
