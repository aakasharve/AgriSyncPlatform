using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Labour;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class FieldOperatorWorkRowConfiguration : IEntityTypeConfiguration<FieldOperatorWorkRow>
{
    public void Configure(EntityTypeBuilder<FieldOperatorWorkRow> builder)
    {
        builder.ToTable("field_operator_work_rows");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.FieldOperatorId)
            .HasColumnName("field_operator_id")
            .IsRequired();

        builder.Property(x => x.LabourAssignmentId)
            .HasColumnName("labour_assignment_id")
            .IsRequired();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        builder.Property(x => x.WorkDate)
            .HasColumnName("work_date")
            .IsRequired();

        // Snapshot at attach time — never updated (Scenario 7). See the
        // FieldOperatorWorkRow class remarks.
        builder.Property(x => x.DisplayNameAtAttach)
            .HasColumnName("display_name_at_attach")
            .HasMaxLength(200)
            .IsRequired();

        builder.Property(x => x.RecordedByUserId)
            .HasColumnName("recorded_by_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        // All THREE FKs are shadow-style (neither side has a navigation
        // property) with DeleteBehavior.Restrict, same idiom as
        // CostEntryConfiguration's CategoryId FK. RESTRICT everywhere is
        // deliberate: destroying a farm, an operator identity, or an
        // engagement must FAIL while attribution rows reference them rather
        // than silently erasing who worked (Constraint 13). Note the
        // divergence from labour_assignments.daily_log_id, which is CASCADE —
        // that cascade is exactly why the demo seeder teardown must remove
        // work rows BEFORE it removes daily logs (Task 10.4).
        builder.HasOne<FieldOperator>()
            .WithMany()
            .HasForeignKey(x => x.FieldOperatorId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<LabourAssignment>()
            .WithMany()
            .HasForeignKey(x => x.LabourAssignmentId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<Farm>()
            .WithMany()
            .HasForeignKey(x => x.FarmId)
            .OnDelete(DeleteBehavior.Restrict);

        // Grain is FieldOperator x LabourAssignment, NOT x day (Scenario 9):
        // the same person on two engagements the same date yields two rows,
        // and only a repeat attach to the SAME engagement is rejected.
        builder.HasIndex(x => new { x.FieldOperatorId, x.LabourAssignmentId })
            .IsUnique()
            .HasDatabaseName("ux_field_operator_work_rows_operator_assignment");

        builder.HasIndex(x => x.FarmId)
            .HasDatabaseName("ix_field_operator_work_rows_farm_id");

        builder.Ignore(x => x.DomainEvents);
    }
}
