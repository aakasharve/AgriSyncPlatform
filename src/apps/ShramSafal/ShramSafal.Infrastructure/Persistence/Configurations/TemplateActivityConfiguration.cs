using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class TemplateActivityConfiguration : IEntityTypeConfiguration<TemplateActivity>
{
    public void Configure(EntityTypeBuilder<TemplateActivity> builder)
    {
        builder.ToTable("template_activities");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.ScheduleTemplateId)
            .HasColumnName("schedule_template_id")
            .IsRequired();

        builder.Property(x => x.ActivityName)
            .HasColumnName("activity_name")
            .HasMaxLength(120)
            .IsRequired();

        builder.Property(x => x.OffsetDays)
            .HasColumnName("offset_days")
            .IsRequired();

        // spec: plr-d10 lane SCH-A (Task 1) - the days ShramSafal stores. NULL on every row made before the lane = "days not
        // stored". FrequencyMode / IntervalDays are the in-memory read (the stored value, else the old default).
        builder.Ignore(x => x.FrequencyMode);
        builder.Ignore(x => x.IntervalDays);
        builder.Ignore(x => x.HasStoredDays);

        builder.Property(x => x.EndDay).HasColumnName("end_day");

        builder.Property(x => x.StoredFrequencyMode)
            .HasColumnName("frequency_mode")
            .HasMaxLength(12)
            .HasConversion(
                v => v.HasValue ? v.Value.ToString() : null,
                v => v == null ? (FrequencyMode?)null : Enum.Parse<FrequencyMode>(v));

        builder.Property(x => x.StoredIntervalDays).HasColumnName("interval_days");
        builder.Property(x => x.Part).HasColumnName("part").HasMaxLength(12);
        builder.Property(x => x.OperationKey).HasColumnName("operation_key").HasMaxLength(40);
        builder.Property(x => x.AfterActivityId).HasColumnName("after_activity_id");
        builder.Property(x => x.Role).HasColumnName("role").HasMaxLength(16);
        builder.Property(x => x.NutrientKey).HasColumnName("nutrient_key").HasMaxLength(24);
        builder.Ignore(x => x.DomainEvents);
    }
}
