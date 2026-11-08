// spec: plr-d10 lane SCH-A (Task 1)
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// spec: plr-d10 lane SCH-A (Task 1; founder D-74, L8-R) - <c>ssf.schedule_checks</c>: ShramSafal's check of a library
/// schedule, one unchangeable row per decision. ShramSafal PLATFORM data: no farm owns a check. The append-only grants live
/// in the migration (<c>AddScheduleCheckAndStoredDays</c>); the database grants no UPDATE / DELETE. The decision is stored as
/// its word (<c>Approved | Returned | Withdrawn</c>).
/// </summary>
internal sealed class ScheduleCheckConfiguration : IEntityTypeConfiguration<ScheduleCheck>
{
    public void Configure(EntityTypeBuilder<ScheduleCheck> builder)
    {
        builder.ToTable("schedule_checks", t =>
        {
            t.HasCheckConstraint("ck_schedule_checks_decision", "decision IN ('Approved', 'Returned', 'Withdrawn')");
            t.HasCheckConstraint(
                "ck_schedule_checks_note_when_not_approved",
                "decision = 'Approved' OR (note IS NOT NULL AND length(btrim(note)) > 0)");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();

        builder.Property(x => x.ScheduleTemplateId).HasColumnName("schedule_template_id").IsRequired();
        builder.Property(x => x.TemplateVersion).HasColumnName("template_version").IsRequired();

        builder.Property(x => x.Decision)
            .HasColumnName("decision")
            .HasMaxLength(12)
            .HasConversion(v => v.ToString(), v => Enum.Parse<ScheduleCheckDecision>(v))
            .IsRequired();

        builder.Property(x => x.CheckedActivityIds)
            .HasColumnName("checked_activity_ids")
            .HasColumnType("uuid[]")
            .IsRequired();

        builder.Property(x => x.Note).HasColumnName("note").HasMaxLength(ScheduleCheck.MaxNoteLength);

        builder.Property(x => x.CheckerUserId)
            .HasColumnName("checker_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.CheckerDisplayName)
            .HasColumnName("checker_display_name")
            .HasMaxLength(ScheduleCheck.MaxDisplayNameLength)
            .IsRequired();

        builder.Property(x => x.CheckedAtUtc).HasColumnName("checked_at_utc").IsRequired();

        builder.HasIndex(x => new { x.ScheduleTemplateId, x.CheckedAtUtc }).HasDatabaseName("ix_schedule_checks_template_checked");
        builder.Ignore(x => x.DomainEvents);
    }
}
