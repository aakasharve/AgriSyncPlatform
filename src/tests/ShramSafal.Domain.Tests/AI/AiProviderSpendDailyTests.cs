using ShramSafal.Domain.AI;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.7 (Safeguard S9) —
/// invariants for the new <see cref="AiProviderSpendDaily"/> rollup
/// entity that the cost guardrail worker upserts to.
/// </summary>
public sealed class AiProviderSpendDailyTests
{
    [Fact]
    public void Create_stamps_timestamps_and_round_trips_columns()
    {
        var nowUtc = new DateTime(2026, 5, 22, 12, 0, 0, DateTimeKind.Utc);
        var tenantId = Guid.NewGuid();
        var day = DateOnly.FromDateTime(nowUtc);

        var row = AiProviderSpendDaily.Create(
            id: Guid.NewGuid(),
            tenantId: tenantId,
            provider: AiProviderType.Sarvam,
            operation: AiOperationType.VoiceToStructuredLog,
            dayUtc: day,
            totalInr: 12.50m,
            nowUtc: nowUtc);

        Assert.Equal(tenantId, row.TenantId);
        Assert.Equal(AiProviderType.Sarvam, row.Provider);
        Assert.Equal(AiOperationType.VoiceToStructuredLog, row.Operation);
        Assert.Equal(day, row.DayUtc);
        Assert.Equal(12.50m, row.TotalInr);
        Assert.Equal(nowUtc, row.CreatedAtUtc);
        Assert.Equal(nowUtc, row.ModifiedAtUtc);
    }

    [Fact]
    public void Create_with_empty_id_generates_new_guid()
    {
        var row = AiProviderSpendDaily.Create(
            id: Guid.Empty,
            tenantId: Guid.NewGuid(),
            provider: AiProviderType.Gemini,
            operation: AiOperationType.ReceiptToExpenseItems,
            dayUtc: new DateOnly(2026, 5, 22),
            totalInr: 1.00m,
            nowUtc: DateTime.UtcNow);

        Assert.NotEqual(Guid.Empty, row.Id);
    }

    [Fact]
    public void Create_clamps_negative_total_to_zero()
    {
        var row = AiProviderSpendDaily.Create(
            id: Guid.NewGuid(),
            tenantId: Guid.NewGuid(),
            provider: AiProviderType.Sarvam,
            operation: AiOperationType.VoiceToStructuredLog,
            dayUtc: new DateOnly(2026, 5, 22),
            totalInr: -42m,
            nowUtc: DateTime.UtcNow);

        Assert.Equal(0m, row.TotalInr);
    }

    [Fact]
    public void SetTotal_overwrites_total_and_bumps_ModifiedAtUtc()
    {
        var createdUtc = new DateTime(2026, 5, 22, 12, 0, 0, DateTimeKind.Utc);
        var row = AiProviderSpendDaily.Create(
            id: Guid.NewGuid(),
            tenantId: Guid.NewGuid(),
            provider: AiProviderType.Sarvam,
            operation: AiOperationType.VoiceToStructuredLog,
            dayUtc: new DateOnly(2026, 5, 22),
            totalInr: 10m,
            nowUtc: createdUtc);

        var laterUtc = createdUtc.AddHours(1);
        row.SetTotal(99.99m, laterUtc);

        Assert.Equal(99.99m, row.TotalInr);
        Assert.Equal(createdUtc, row.CreatedAtUtc);
        Assert.Equal(laterUtc, row.ModifiedAtUtc);
    }

    [Fact]
    public void SetTotal_clamps_negative_to_zero()
    {
        var row = AiProviderSpendDaily.Create(
            id: Guid.NewGuid(),
            tenantId: Guid.NewGuid(),
            provider: AiProviderType.Sarvam,
            operation: AiOperationType.VoiceToStructuredLog,
            dayUtc: new DateOnly(2026, 5, 22),
            totalInr: 10m,
            nowUtc: DateTime.UtcNow);

        row.SetTotal(-50m, DateTime.UtcNow);
        Assert.Equal(0m, row.TotalInr);
    }
}
