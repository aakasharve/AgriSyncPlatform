using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Compliance;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class ComplianceSignalConfiguration : IEntityTypeConfiguration<ComplianceSignal>
{
    public void Configure(EntityTypeBuilder<ComplianceSignal> builder)
    {
        builder.ToTable("compliance_signals");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        builder.Property(x => x.PlotId)
            .HasColumnName("plot_id")
            .IsRequired();

        builder.Property(x => x.CropCycleId)
            .HasColumnName("crop_cycle_id");

        builder.Property(x => x.RuleCode)
            .HasColumnName("rule_code")
            .HasMaxLength(120)
            .IsRequired();

        builder.Property(x => x.Severity)
            .HasColumnName("severity")
            .HasConversion<string>()
            .HasMaxLength(30)
            .IsRequired();

        // CEI-I6: SuggestedAction is NOT NULL
        builder.Property(x => x.SuggestedAction)
            .HasColumnName("suggested_action")
            .HasConversion<string>()
            .HasMaxLength(60)
            .IsRequired();

        builder.Property(x => x.TitleEn)
            .HasColumnName("title_en")
            .HasMaxLength(255)
            .IsRequired();

        builder.Property(x => x.TitleMr)
            .HasColumnName("title_mr")
            .HasMaxLength(255)
            .IsRequired();

        builder.Property(x => x.DescriptionEn)
            .HasColumnName("description_en")
            .HasMaxLength(1000)
            .IsRequired();

        builder.Property(x => x.DescriptionMr)
            .HasColumnName("description_mr")
            .HasMaxLength(1000)
            .IsRequired();

        builder.Property(x => x.PayloadJson)
            .HasColumnName("payload_json")
            .HasColumnType("jsonb")
            .IsRequired();

        builder.Property(x => x.FirstSeenAtUtc)
            .HasColumnName("first_seen_at_utc")
            .IsRequired();

        builder.Property(x => x.LastSeenAtUtc)
            .HasColumnName("last_seen_at_utc")
            .IsRequired();

        builder.Property(x => x.AcknowledgedAtUtc)
            .HasColumnName("acknowledged_at_utc");

        builder.Property(x => x.AcknowledgedByUserId)
            .HasColumnName("acknowledged_by_user_id")
            .HasConversion(
                v => v.HasValue ? (Guid?)v.Value.Value : null,
                v => v.HasValue ? (AgriSync.SharedKernel.Contracts.Ids.UserId?)new AgriSync.SharedKernel.Contracts.Ids.UserId(v.Value) : null);

        builder.Property(x => x.ResolvedAtUtc)
            .HasColumnName("resolved_at_utc");

        builder.Property(x => x.ResolvedByUserId)
            .HasColumnName("resolved_by_user_id")
            .HasConversion(
                v => v.HasValue ? (Guid?)v.Value.Value : null,
                v => v.HasValue ? (AgriSync.SharedKernel.Contracts.Ids.UserId?)new AgriSync.SharedKernel.Contracts.Ids.UserId(v.Value) : null);

        builder.Property(x => x.ResolutionNote)
            .HasColumnName("resolution_note")
            .HasMaxLength(2000);

        // Partial unique index: at most one open signal per (farm_id, plot_id, rule_code, crop_cycle_id)
        // A signal is "open" when both resolved_at_utc and acknowledged_at_utc are null.
        builder.HasIndex(x => new { x.FarmId, x.PlotId, x.RuleCode, x.CropCycleId })
            .HasFilter("resolved_at_utc IS NULL AND acknowledged_at_utc IS NULL")
            .IsUnique()
            .HasDatabaseName("ix_compliance_signals_open_unique");

        // Index on last_seen_at_utc for cursor-based sync
        builder.HasIndex(x => x.LastSeenAtUtc)
            .HasDatabaseName("ix_compliance_signals_last_seen_at_utc");

        // Index on farm_id for fast farm-scoped queries
        builder.HasIndex(x => x.FarmId)
            .HasDatabaseName("ix_compliance_signals_farm_id");

        builder.Ignore(x => x.DomainEvents);
        builder.Ignore(x => x.IsOpen);
    }
}
