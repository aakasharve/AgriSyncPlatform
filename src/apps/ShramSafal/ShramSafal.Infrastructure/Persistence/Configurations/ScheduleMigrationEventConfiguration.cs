using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class ScheduleMigrationEventConfiguration : IEntityTypeConfiguration<ScheduleMigrationEvent>
{
    public void Configure(EntityTypeBuilder<ScheduleMigrationEvent> builder)
    {
        builder.ToTable("schedule_migration_events");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("event_id")
            .ValueGeneratedNever();

        builder.Property(x => x.PrevSubscriptionId)
            .HasColumnName("prev_subscription_id")
            .HasConversion(TypedIdConverters.ScheduleSubscriptionId)
            .IsRequired();

        builder.Property(x => x.NewSubscriptionId)
            .HasColumnName("new_subscription_id")
            .HasConversion(TypedIdConverters.ScheduleSubscriptionId)
            .IsRequired();

        builder.Property(x => x.PrevScheduleId)
            .HasColumnName("prev_schedule_id")
            .HasConversion(TypedIdConverters.ScheduleTemplateId)
            .IsRequired();

        builder.Property(x => x.NewScheduleId)
            .HasColumnName("new_schedule_id")
            .HasConversion(TypedIdConverters.ScheduleTemplateId)
            .IsRequired();

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

        builder.Property(x => x.MigratedAtUtc)
            .HasColumnName("migrated_at_utc")
            .IsRequired();

        builder.Property(x => x.Reason)
            .HasColumnName("reason")
            .HasConversion<int>()
            .IsRequired();

        builder.Property(x => x.ReasonText)
            .HasColumnName("reason_text")
            .HasMaxLength(500);

        builder.Property(x => x.ComplianceAtMigrationPct)
            .HasColumnName("compliance_at_migration_pct")
            .HasPrecision(5, 2)
            .IsRequired();

        builder.Property(x => x.ActorUserId)
            .HasColumnName("actor_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Ignore(x => x.EventId);
        builder.Ignore(x => x.DomainEvents);

        builder.HasIndex(x => x.FarmId);
        builder.HasIndex(x => x.PlotId);
        builder.HasIndex(x => x.CropCycleId);
        builder.HasIndex(x => x.PrevSubscriptionId);
        builder.HasIndex(x => x.NewSubscriptionId);
    }
}
