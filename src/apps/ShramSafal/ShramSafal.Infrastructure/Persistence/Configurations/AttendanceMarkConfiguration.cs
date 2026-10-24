using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Labour;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class AttendanceMarkConfiguration : IEntityTypeConfiguration<AttendanceMark>
{
    public void Configure(EntityTypeBuilder<AttendanceMark> builder)
    {
        builder.ToTable("attendance_marks");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        builder.Property(x => x.FieldOperatorId)
            .HasColumnName("field_operator_id")
            .IsRequired();

        builder.Property(x => x.WorkDate)
            .HasColumnName("work_date")
            .IsRequired();

        // Stored as the enum's INT, with Unmarked = 0 (see the enum's own doc).
        // A row that somehow arrives with an unset column therefore reads as
        // "nobody said", never as "he did not come" — the default must not be
        // able to become an accusation.
        builder.Property(x => x.Day)
            .HasColumnName("day_mark")
            .IsRequired();

        builder.Property(x => x.Night)
            .HasColumnName("night_mark")
            .IsRequired();

        // Founder master review 2026-09-02 — hours provenance ships in the
        // CREATING migration; added after rows exist it is unrecoverable for
        // every earlier row. numeric(4,1) matches the STATED grain (one
        // decimal); the domain guard refuses finer, so stored == stated.
        builder.Property(x => x.HoursWorked)
            .HasColumnName("hours_worked")
            .HasColumnType("numeric(4,1)");

        builder.Property(x => x.ExtraHours)
            .HasColumnName("extra_hours")
            .HasColumnType("numeric(4,1)");

        builder.Property(x => x.HoursBasis)
            .HasColumnName("hours_basis")
            .HasDefaultValue(LabourTimeBasis.Unspecified)
            .IsRequired();

        builder.Property(x => x.RecordedByUserId)
            .HasColumnName("recorded_by_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.RecordedAtUtc)
            .HasColumnName("recorded_at_utc")
            .IsRequired();

        builder.Property(x => x.ModifiedAtUtc)
            .HasColumnName("modified_at_utc")
            .IsRequired();

        // ONE ruling per person per farm-day. The uniqueness is the whole grain
        // of D-H3: a second row for the same person-day would be a second
        // opinion with no way to tell which is current, and both halves of the
        // cell live on ONE row precisely so day and night cannot drift apart.
        builder.HasIndex(x => new { x.FarmId, x.FieldOperatorId, x.WorkDate })
            .IsUnique()
            .HasDatabaseName("ux_attendance_marks_farm_operator_day");

        // The register reads a farm's marks across a window, so this is the
        // index that read actually uses.
        builder.HasIndex(x => new { x.FarmId, x.WorkDate })
            .HasDatabaseName("ix_attendance_marks_farm_day");
    }
}
