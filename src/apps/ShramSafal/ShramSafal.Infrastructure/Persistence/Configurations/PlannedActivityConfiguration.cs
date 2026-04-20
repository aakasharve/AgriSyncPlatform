using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class PlannedActivityConfiguration : IEntityTypeConfiguration<PlannedActivity>
{
    public void Configure(EntityTypeBuilder<PlannedActivity> builder)
    {
        builder.ToTable("planned_activities");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.CropCycleId)
            .HasColumnName("crop_cycle_id")
            .IsRequired();

        builder.Property(x => x.ActivityName)
            .HasColumnName("activity_name")
            .HasMaxLength(120)
            .IsRequired();

        builder.Property(x => x.Stage)
            .HasColumnName("stage")
            .HasMaxLength(80)
            .IsRequired();

        builder.Property(x => x.PlannedDate)
            .HasColumnName("planned_date")
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.Property(x => x.ModifiedAtUtc)
            .HasColumnName("modified_at_utc")
            .IsRequired();

        // CEI Phase 1: local override + soft-delete fields
        builder.Property(x => x.SourceTemplateActivityId)
            .HasColumnName("source_template_activity_id");

        builder.Property(x => x.OverrideReason)
            .HasColumnName("override_reason")
            .HasMaxLength(500);

        builder.Property(x => x.OverriddenByUserId)
            .HasColumnName("overridden_by_user_id")
            .HasConversion(
                v => v.HasValue ? (Guid?)v.Value.Value : null,
                v => v.HasValue ? (UserId?)new UserId(v.Value) : null);

        builder.Property(x => x.OverriddenAtUtc)
            .HasColumnName("overridden_at_utc");

        builder.Property(x => x.RemovedAtUtc)
            .HasColumnName("removed_at_utc");

        builder.Property(x => x.RemovedByUserId)
            .HasColumnName("removed_by_user_id")
            .HasConversion(
                v => v.HasValue ? (Guid?)v.Value.Value : null,
                v => v.HasValue ? (UserId?)new UserId(v.Value) : null);

        builder.Property(x => x.RemovedReason)
            .HasColumnName("removed_reason")
            .HasMaxLength(500);

        // Computed properties — not persisted
        builder.Ignore(x => x.IsLocallyAdded);
        builder.Ignore(x => x.IsLocallyChanged);
        builder.Ignore(x => x.IsRemoved);

        builder.HasIndex(x => new { x.CropCycleId, x.PlannedDate });
        builder.HasIndex(x => x.ModifiedAtUtc);
        builder.Ignore(x => x.DomainEvents);
    }
}
