using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.AI;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE Task 1.5a — diarization-as-capability
/// policy table (founder blocker #4). Mapped to
/// <c>ssf.diarization_policy</c>. Unique on <c>trigger_type</c> so each
/// trigger maps to at most one diarization rule. Separate from
/// <see cref="ModePolicyConfiguration"/> so diarization is honestly
/// modeled as a capability flag, not a Sarvam STT mode.
/// </summary>
internal sealed class DiarizationPolicyConfiguration : IEntityTypeConfiguration<DiarizationPolicy>
{
    public void Configure(EntityTypeBuilder<DiarizationPolicy> builder)
    {
        builder.ToTable("diarization_policy");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("id")
            .ValueGeneratedNever();

        builder.Property(x => x.TriggerType)
            .HasColumnName("trigger_type")
            .HasMaxLength(64)
            .IsRequired();

        builder.Property(x => x.Enabled)
            .HasColumnName("enabled")
            .HasDefaultValue(false)
            .IsRequired();

        builder.Property(x => x.MaxDailyCostInr)
            .HasColumnName("max_daily_cost_inr")
            .HasPrecision(10, 2);

        builder.Property(x => x.AppliesToEventType)
            .HasColumnName("applies_to_event_type")
            .HasMaxLength(64);

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.Property(x => x.ModifiedAtUtc)
            .HasColumnName("modified_at_utc")
            .IsRequired();

        builder.HasIndex(x => x.TriggerType)
            .IsUnique()
            .HasDatabaseName("ux_diarization_policy_trigger_type");
    }
}
