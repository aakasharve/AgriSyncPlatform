using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.AI;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE Task 1.2 — runtime authority capability
/// table. Mirrors the human-readable matrix in
/// <c>_COFOUNDER/Projects/AgriSync/Architecture/CAPABILITY_MATRIX.md</c>.
/// Unique on the tuple <c>(provider, operation, mode)</c>; mode may be
/// null and the PostgreSQL UNIQUE constraint treats NULLs as distinct
/// per default — for this table that is acceptable because operations
/// without a mode (Gemini variants) only have one row per
/// <c>(provider, operation)</c>.
/// </summary>
internal sealed class AiProviderCapabilityConfiguration : IEntityTypeConfiguration<AiProviderCapability>
{
    public void Configure(EntityTypeBuilder<AiProviderCapability> builder)
    {
        builder.ToTable("ai_provider_capabilities");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("id")
            .ValueGeneratedNever();

        builder.Property(x => x.Provider)
            .HasColumnName("provider")
            .HasMaxLength(64)
            .IsRequired();

        builder.Property(x => x.Operation)
            .HasColumnName("operation")
            .HasMaxLength(64)
            .IsRequired();

        builder.Property(x => x.Mode)
            .HasColumnName("mode")
            .HasMaxLength(32);

        builder.Property(x => x.SupportsStreaming)
            .HasColumnName("supports_streaming")
            .IsRequired();

        builder.Property(x => x.MaxAudioSeconds)
            .HasColumnName("max_audio_seconds");

        builder.Property(x => x.CostPerUnitInr)
            .HasColumnName("cost_per_unit_inr")
            .HasPrecision(10, 4);

        builder.Property(x => x.CostUnit)
            .HasColumnName("cost_unit")
            .HasMaxLength(32);

        builder.Property(x => x.SlaTtftMs)
            .HasColumnName("sla_ttft_ms");

        builder.Property(x => x.IsActive)
            .HasColumnName("is_active")
            .HasDefaultValue(true)
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.Property(x => x.ModifiedAtUtc)
            .HasColumnName("modified_at_utc")
            .IsRequired();

        builder
            .HasIndex(x => new { x.Provider, x.Operation, x.Mode })
            .IsUnique()
            .HasDatabaseName("ux_ai_provider_capabilities_provider_operation_mode");
    }
}
