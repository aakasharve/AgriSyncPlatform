using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class CropScheduleTemplateConfiguration : IEntityTypeConfiguration<CropScheduleTemplate>
{
    public void Configure(EntityTypeBuilder<CropScheduleTemplate> builder)
    {
        builder.ToTable("crop_schedule_templates");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("id")
            .ValueGeneratedNever();

        builder.Property(x => x.TemplateKey)
            .HasColumnName("template_key")
            .HasMaxLength(80)
            .IsRequired();

        builder.Property(x => x.CropKey)
            .HasColumnName("crop_key")
            .HasMaxLength(40)
            .IsRequired();

        builder.Property(x => x.RegionCode)
            .HasColumnName("region_code")
            .HasMaxLength(40);

        builder.Property(x => x.Name)
            .HasColumnName("name")
            .HasMaxLength(160)
            .IsRequired();

        builder.Property(x => x.VersionTag)
            .HasColumnName("version_tag")
            .HasMaxLength(32)
            .IsRequired();

        builder.Property(x => x.IsPublished)
            .HasColumnName("is_published")
            .HasDefaultValue(false)
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.Ignore(x => x.TemplateId);
        builder.Ignore(x => x.DomainEvents);

        builder.HasIndex(x => x.TemplateKey).IsUnique();
        builder.HasIndex(x => new { x.CropKey, x.RegionCode });

        builder.OwnsMany(x => x.Tasks, tasks =>
        {
            tasks.ToTable("crop_schedule_prescribed_tasks");

            tasks.WithOwner().HasForeignKey("schedule_template_id");
            tasks.Property<Guid>("schedule_template_id");

            tasks.HasKey("schedule_template_id", "Id");

            tasks.Property(t => t.Id)
                .HasColumnName("id")
                .HasConversion(TypedIdConverters.PrescribedTaskId)
                .ValueGeneratedNever();

            tasks.Property(t => t.TaskType)
                .HasColumnName("task_type")
                .HasMaxLength(60)
                .IsRequired();

            tasks.Property(t => t.Stage)
                .HasColumnName("stage")
                .HasMaxLength(60)
                .IsRequired();

            tasks.Property(t => t.DayOffsetFromCycleStart)
                .HasColumnName("day_offset")
                .IsRequired();

            tasks.Property(t => t.ToleranceDaysPlusMinus)
                .HasColumnName("tolerance_days_plus_minus")
                .HasDefaultValue(2)
                .IsRequired();

            tasks.Property(t => t.Notes)
                .HasColumnName("notes")
                .HasMaxLength(500);

            tasks.HasIndex("schedule_template_id");
        });

        builder.Navigation(x => x.Tasks).UsePropertyAccessMode(PropertyAccessMode.Field);
    }
}
