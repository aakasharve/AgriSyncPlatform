// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 5, "Own schedule feeds नियोजन")
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// <c>ssf.schedule_task_events</c>: the answers about the sign of an own work (seen / not yet / unsure), APPEND-ONLY by privilege (SELECT and INSERT for the app
/// role). FORCE row security on its own <c>farm_id</c> (F8), the place trigger and the grants live in the migration <c>AddScheduleFeed</c>. No foreign key, on
/// purpose (E4, as <c>own_schedule_items</c>): the trigger checks the own work is of this farm, plot, season and key.
/// </summary>
internal sealed class ScheduleTaskEventConfiguration : IEntityTypeConfiguration<ScheduleTaskEvent>
{
    public void Configure(EntityTypeBuilder<ScheduleTaskEvent> builder)
    {
        builder.ToTable("schedule_task_events", t =>
            t.HasCheckConstraint("ck_schedule_task_events_answer", "answer IN ('seen', 'not_yet', 'unsure')"));

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(x => x.FarmId).HasColumnName("farm_id").HasConversion(TypedIdConverters.FarmId).IsRequired();
        builder.Property(x => x.PlotId).HasColumnName("plot_id").IsRequired();
        builder.Property(x => x.CropCycleId).HasColumnName("crop_cycle_id").IsRequired();
        builder.Property(x => x.OwnItemId).HasColumnName("own_item_id").IsRequired();
        builder.Property(x => x.TaskKey).HasColumnName("task_key").HasMaxLength(80).IsRequired();
        builder.Property(x => x.Answer)
            .HasColumnName("answer")
            .HasMaxLength(8)
            .HasConversion(
                v => ScheduleSignAnswers.ToWire(v),
                v => v == "seen" ? ScheduleSignAnswer.Seen : v == "not_yet" ? ScheduleSignAnswer.NotYet : ScheduleSignAnswer.Unsure)
            .IsRequired();
        builder.Property(x => x.ObservedOn).HasColumnName("observed_on").HasColumnType("date").IsRequired();
        builder.Property(x => x.RecordedByUserId).HasColumnName("recorded_by_user_id").IsRequired();
        builder.Property(x => x.RecordedAtUtc).HasColumnName("recorded_at_utc").IsRequired();

        builder.Ignore(x => x.DomainEvents);

        builder.HasIndex(x => x.FarmId).HasDatabaseName("ix_schedule_task_events_farm");
        builder.HasIndex(x => new { x.PlotId, x.CropCycleId }).HasDatabaseName("ix_schedule_task_events_plot_season");
        builder.HasIndex(x => x.OwnItemId).HasDatabaseName("ix_schedule_task_events_item");
    }
}
