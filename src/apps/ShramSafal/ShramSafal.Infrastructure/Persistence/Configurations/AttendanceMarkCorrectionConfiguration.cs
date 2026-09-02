using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Labour;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class AttendanceMarkCorrectionConfiguration
    : IEntityTypeConfiguration<AttendanceMarkCorrection>
{
    public void Configure(EntityTypeBuilder<AttendanceMarkCorrection> builder)
    {
        builder.ToTable("attendance_mark_corrections");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.AttendanceMarkId)
            .HasColumnName("attendance_mark_id")
            .IsRequired();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        builder.Property(x => x.ChangedField)
            .HasColumnName("changed_field")
            .HasMaxLength(32)
            .IsRequired();

        // Enum NAMES, not numbers. A correction must stay readable years later,
        // and an enum whose members were renumbered would silently rewrite
        // history recorded as integers. 32 is generous for "Unmarked".
        builder.Property(x => x.OriginalValue)
            .HasColumnName("original_value")
            .HasMaxLength(32);

        builder.Property(x => x.NewValue)
            .HasColumnName("new_value")
            .HasMaxLength(32);

        builder.Property(x => x.CorrectedByUserId)
            .HasColumnName("corrected_by_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.CorrectedAtUtc)
            .HasColumnName("corrected_at_utc")
            .IsRequired();

        // The history of one mark, oldest first — the read this table exists for.
        builder.HasIndex(x => new { x.AttendanceMarkId, x.CorrectedAtUtc })
            .HasDatabaseName("ix_attendance_mark_corrections_mark_time");

        builder.HasIndex(x => x.FarmId)
            .HasDatabaseName("ix_attendance_mark_corrections_farm");

        // NO unique index anywhere. The same half of the same mark may be
        // corrected repeatedly, and every one of those is a distinct fact about
        // a distinct moment. A uniqueness rule here would silently discard the
        // second correction of a field somebody changed twice.
    }
}
