using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.AI;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE Task 1.5 — data-driven trigger →
/// mode-list policy table per ADR-DS-016. Mapped to
/// <c>ssf.mode_policy</c>. Indexed on <c>trigger_type</c> so the worker
/// can resolve a trigger to its policy rows in a single hit. Per
/// founder blocker #4, the <c>modes_to_run</c> column NEVER carries
/// diarization — that lives in <see cref="DiarizationPolicyConfiguration"/>.
/// </summary>
internal sealed class ModePolicyConfiguration : IEntityTypeConfiguration<ModePolicy>
{
    public void Configure(EntityTypeBuilder<ModePolicy> builder)
    {
        builder.ToTable("mode_policy");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("id")
            .ValueGeneratedNever();

        builder.Property(x => x.TriggerType)
            .HasColumnName("trigger_type")
            .HasMaxLength(64)
            .IsRequired();

        builder.Property(x => x.ModesToRun)
            .HasColumnName("modes_to_run")
            .HasMaxLength(256)
            .IsRequired();

        builder.Property(x => x.Priority)
            .HasColumnName("priority")
            .IsRequired();

        builder.Property(x => x.MaxDailyCostInr)
            .HasColumnName("max_daily_cost_inr")
            .HasPrecision(10, 2);

        builder.Property(x => x.AppliesToEventType)
            .HasColumnName("applies_to_event_type")
            .HasMaxLength(64);

        builder.Property(x => x.Enabled)
            .HasColumnName("enabled")
            .HasDefaultValue(true)
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.Property(x => x.ModifiedAtUtc)
            .HasColumnName("modified_at_utc")
            .IsRequired();

        builder.HasIndex(x => x.TriggerType)
            .HasDatabaseName("ix_mode_policy_trigger_type");
    }
}
