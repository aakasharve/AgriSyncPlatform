using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class ScheduleSubscriptionConfiguration : IEntityTypeConfiguration<ScheduleSubscription>
{
    public void Configure(EntityTypeBuilder<ScheduleSubscription> builder)
    {
        builder.ToTable("schedule_subscriptions", t =>
        {
            // spec: plr-d10 lane L8b-1F - the two marks hold only their names (NULL = chosen before this lane).
            t.HasCheckConstraint("ck_sched_sub_origin", "origin IS NULL OR origin IN ('Outside','Own')");
            t.HasCheckConstraint("ck_sched_sub_check_state_at_adopt", "check_state_at_adopt IS NULL OR check_state_at_adopt IN ('Checked','NotChecked')");
            // spec: plr-d10 lane L8b-3 (founder D-74, "3 + 1") - a place is 0 (his own) or 1..3 (outside); his own is place 0 and nothing
            // else is. A row with no place (NULL) is allowed: the deployed binary writes none (E8).
            t.HasCheckConstraint("ck_sched_sub_slot_range", "slot IS NULL OR slot BETWEEN 0 AND 3");
            t.HasCheckConstraint("ck_sched_sub_slot_origin", "slot IS NULL OR (origin IS NOT NULL AND ((origin = 'Own') = (slot = 0)))");
        });

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

        // spec: plr-d10 lane L8b-1 — the plot's day 0 (NULL = the crop season's start).
        builder.Property(x => x.ReferenceDate)
            .HasColumnName("reference_date")
            .HasColumnType("date");

        // spec: plr-d10 lane L8b-1F (R5, R7) - whose schedule it is (Outside|Own; NULL = chosen before this lane, read as Outside)
        // and what the check said when it was chosen (Checked|NotChecked; NULL = chosen before this lane).
        builder.Property(x => x.Origin)
            .HasColumnName("origin")
            .HasMaxLength(8)
            .HasConversion<string>();

        builder.Property(x => x.CheckStateAtAdopt)
            .HasColumnName("check_state_at_adopt")
            .HasMaxLength(12)
            .HasConversion<string>();

        // spec: plr-d10 lane L8b-3 (founder D-74, "3 + 1") - the place this schedule holds on its plot-season: 0 = his own, 1..3 = outside.
        builder.Property(x => x.Slot)
            .HasColumnName("slot")
            .HasColumnType("smallint");

        builder.Ignore(x => x.SubscriptionId);
        builder.Ignore(x => x.DomainEvents);

        builder.HasIndex(x => x.FarmId);
        builder.HasIndex(x => x.PlotId);
        builder.HasIndex(x => x.CropCycleId);
        builder.HasIndex(x => x.ScheduleTemplateId);

        // spec: plr-d10 lane L8b-3 (founder D-74, "3 + 1") - replaces invariant I-14 (one Active subscription per plot, crop_key, cycle).
        // A plot-season follows up to 3 outside schedules plus 1 of his own, each in its OWN place, so two phones racing for the last
        // place cannot both win; and never the same schedule twice. Both partial unique indexes cover Active rows only. "One own
        // schedule per plot-season" is already held: his own is place 0 (ck_sched_sub_slot_origin) and place 0 is unique.
        builder.HasIndex(x => new { x.PlotId, x.CropCycleId, x.Slot })
            .HasDatabaseName("ux_sched_sub_active_slot")
            .HasFilter("state = 0")
            .IsUnique();

        builder.HasIndex(x => new { x.PlotId, x.CropCycleId, x.ScheduleTemplateId })
            .HasDatabaseName("ux_sched_sub_active_template")
            .HasFilter("state = 0")
            .IsUnique();
    }
}
