using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Labour;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 12b.1) —
/// copied from <see cref="FinanceCorrectionConfiguration"/>, the house pattern
/// for correction history, with two deliberate divergences:
/// <list type="number">
/// <item>a DIRECT <c>farm_id</c> column (RLS key), which
/// <c>FinanceCorrection</c> does not carry;</item>
/// <item>no <c>modified_at_utc</c> — this table is append-only, so a
/// "last modified" column would advertise an update path that does not
/// exist.</item>
/// </list>
/// </summary>
internal sealed class LabourCorrectionConfiguration : IEntityTypeConfiguration<LabourCorrection>
{
    public void Configure(EntityTypeBuilder<LabourCorrection> builder)
    {
        builder.ToTable("labour_corrections");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.LabourAssignmentId)
            .HasColumnName("labour_assignment_id")
            .IsRequired();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        builder.Property(x => x.ChangedField)
            .HasColumnName("changed_field")
            .HasMaxLength(40)
            .IsRequired();

        // NULLABLE on both sides, on purpose: null means "absent on this side of
        // the change" — an attribution that did not exist before, or no longer
        // exists after. It never means zero.
        builder.Property(x => x.OriginalValue)
            .HasColumnName("original_value")
            .HasMaxLength(200);

        builder.Property(x => x.NewValue)
            .HasColumnName("new_value")
            .HasMaxLength(200);

        builder.Property(x => x.Reason)
            .HasColumnName("reason")
            .HasMaxLength(400);

        builder.Property(x => x.CorrectedByUserId)
            .HasColumnName("corrected_by_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.CorrectedAtUtc)
            .HasColumnName("corrected_at_utc")
            .IsRequired();

        // Shadow-style FKs (no navigation on either side), RESTRICT on both —
        // same idiom and same reasoning as FieldOperatorWorkRowConfiguration:
        // destroying a farm or an engagement must FAIL while correction history
        // references it rather than silently erasing what the record used to say.
        builder.HasOne<LabourAssignment>()
            .WithMany()
            .HasForeignKey(x => x.LabourAssignmentId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<Farm>()
            .WithMany()
            .HasForeignKey(x => x.FarmId)
            .OnDelete(DeleteBehavior.Restrict);

        // The history read is always "what happened to THIS engagement, oldest
        // first" — mirrors FinanceCorrection's (CostEntryId, CorrectedAtUtc).
        builder.HasIndex(x => new { x.LabourAssignmentId, x.CorrectedAtUtc })
            .HasDatabaseName("ix_labour_corrections_assignment_corrected_at");

        builder.HasIndex(x => x.FarmId)
            .HasDatabaseName("ix_labour_corrections_farm_id");

        builder.Ignore(x => x.DomainEvents);
    }
}
