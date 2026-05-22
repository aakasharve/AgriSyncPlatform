using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.AI;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.7 (Safeguard S9) — EF
/// configuration for the <c>ssf.ai_provider_spend_daily</c> rollup table
/// the cost guardrail worker writes on every tick.
///
/// <para>
/// <b>Indexing.</b> The composite index on <c>(tenant_id, day_utc)</c>
/// is the hot-path the guardrail probes on every cycle ("month-to-date
/// total for tenant X"). The unique index on
/// <c>(tenant_id, provider, operation, day_utc)</c> backs the upsert
/// semantics — one row per tenant × provider × operation × day.
/// </para>
/// </summary>
internal sealed class AiProviderSpendDailyConfiguration : IEntityTypeConfiguration<AiProviderSpendDaily>
{
    public void Configure(EntityTypeBuilder<AiProviderSpendDaily> builder)
    {
        builder.ToTable("ai_provider_spend_daily");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("id")
            .ValueGeneratedNever();

        builder.Property(x => x.TenantId)
            .HasColumnName("tenant_id")
            .IsRequired();

        builder.Property(x => x.Provider)
            .HasColumnName("provider")
            .HasConversion<string>()
            .HasMaxLength(64)
            .IsRequired();

        builder.Property(x => x.Operation)
            .HasColumnName("operation")
            .HasConversion<string>()
            .HasMaxLength(64)
            .IsRequired();

        builder.Property(x => x.DayUtc)
            .HasColumnName("day_utc")
            .IsRequired();

        builder.Property(x => x.TotalInr)
            .HasColumnName("total_inr")
            .HasPrecision(14, 4)
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.Property(x => x.ModifiedAtUtc)
            .HasColumnName("modified_at_utc")
            .IsRequired();

        builder.HasIndex(x => new { x.TenantId, x.DayUtc })
            .HasDatabaseName("ix_ai_provider_spend_daily_tenant_day");

        builder.HasIndex(x => new { x.TenantId, x.Provider, x.Operation, x.DayUtc })
            .IsUnique()
            .HasDatabaseName("ux_ai_provider_spend_daily_tenant_provider_operation_day");
    }
}
