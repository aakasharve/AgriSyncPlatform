using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class ScheduleSubscriptionConfiguration : IEntityTypeConfiguration<ScheduleSubscription>
{
    public void Configure(EntityTypeBuilder<ScheduleSubscription> builder)
    {
        builder.ToTable("schedule_subscriptions");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("id")
            .ValueGeneratedNever();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        builder.Property(x => x.PlotId)
            .HasColumnName("plot_id")
            .IsRequired();

        builder.Property(x => x.CropCycleId)
            .HasColumnName("crop_cycle_id")
            .IsRequired();

        builder.Property(x => x.CropKey)
            .HasColumnName("crop_key")
            .HasMaxLength(40)
            .IsRequired();

        builder.Property(x => x.ScheduleTemplateId)
            .HasColumnName("schedule_template_id")
            .HasConversion(TypedIdConverters.ScheduleTemplateId)
            .IsRequired();

        builder.Property(x => x.ScheduleVersionTag)
            .HasColumnName("schedule_version_tag")
            .HasMaxLength(32)
            .IsRequired();

        builder.Property(x => x.AdoptedAtUtc)
            .HasColumnName("adopted_at_utc")
            .IsRequired();

        builder.Property(x => x.State)
            .HasColumnName("state")
            .HasConversion<int>()
            .HasDefaultValue(ScheduleSubscriptionState.Active)
            .IsRequired();

        builder.Property(x => x.MigratedFromSubscriptionId)
            .HasColumnName("migrated_from_subscription_id")
            .HasConversion(TypedIdConverters.NullableScheduleSubscriptionId);

        builder.Property(x => x.MigratedToSubscriptionId)
            .HasColumnName("migrated_to_subscription_id")
            .HasConversion(TypedIdConverters.NullableScheduleSubscriptionId);

        builder.Property(x => x.MigrationReason)
            .HasColumnName("migration_reason")
            .HasConversion<int?>();

        builder.Property(x => x.StateChangedAtUtc)
            .HasColumnName("state_changed_at_utc");

        builder.Ignore(x => x.SubscriptionId);
        builder.Ignore(x => x.DomainEvents);

        builder.HasIndex(x => x.FarmId);
        builder.HasIndex(x => x.PlotId);
        builder.HasIndex(x => x.CropCycleId);
        builder.HasIndex(x => x.ScheduleTemplateId);

        // Invariant I-14: at most one Active subscription per (plot, crop_key, crop_cycle).
        // Enforced by a partial unique index.
        builder.HasIndex(x => new { x.PlotId, x.CropKey, x.CropCycleId })
            .HasDatabaseName("ux_sched_sub_active")
            .HasFilter("state = 0")
            .IsUnique();
    }
}
