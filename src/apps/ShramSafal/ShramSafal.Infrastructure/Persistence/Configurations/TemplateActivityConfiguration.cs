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

        builder.Ignore(x => x.FrequencyMode);
        builder.Ignore(x => x.IntervalDays);
        builder.Ignore(x => x.DomainEvents);
    }
}
