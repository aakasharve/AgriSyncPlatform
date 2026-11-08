// spec: plr-d10 lane SCH-A (Task 1)
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// spec: plr-d10 lane SCH-A (Task 1) - <c>ssf.schedule_template_stages</c>: a schedule row's stored stages (name and day
/// range, in order). Author-scoped like <c>ssf.schedule_templates</c>: no farm owns it, the application's one visibility rule
/// gates it (see RlsExemptionAllowlistTests).
/// </summary>
internal sealed class ScheduleTemplateStageConfiguration : IEntityTypeConfiguration<ScheduleTemplateStage>
{
    public void Configure(EntityTypeBuilder<ScheduleTemplateStage> builder)
    {
        builder.ToTable("schedule_template_stages", t =>
            t.HasCheckConstraint("ck_schedule_template_stages_days", "start_day <= end_day"));

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();

        builder.Property(x => x.ScheduleTemplateId).HasColumnName("schedule_template_id").IsRequired();
        builder.Property(x => x.OrderIndex).HasColumnName("order_index").HasColumnType("smallint").IsRequired();
        builder.Property(x => x.Name).HasColumnName("name").HasMaxLength(ScheduleTemplate.MaxStageNameLength).IsRequired();
        builder.Property(x => x.StartDay).HasColumnName("start_day").IsRequired();
        builder.Property(x => x.EndDay).HasColumnName("end_day").IsRequired();

        builder.HasIndex(x => x.ScheduleTemplateId).HasDatabaseName("ix_schedule_template_stages_template");
        builder.Ignore(x => x.DomainEvents);
    }
}
