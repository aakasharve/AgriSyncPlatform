using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class LabourAssignmentConfiguration : IEntityTypeConfiguration<LabourAssignment>
{
    public void Configure(EntityTypeBuilder<LabourAssignment> builder)
    {
        builder.ToTable("labour_assignments");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.DailyLogId).HasColumnName("daily_log_id").IsRequired();

        builder.Property(x => x.EngagementType)
            .HasColumnName("engagement_type").HasConversion<string>().HasMaxLength(20).IsRequired();

        builder.Property(x => x.MaleCount).HasColumnName("male_count");
        builder.Property(x => x.FemaleCount).HasColumnName("female_count");
        builder.Property(x => x.WorkerCount).HasColumnName("worker_count");
        builder.Property(x => x.WagePerPerson).HasColumnName("wage_per_person");

        builder.Property(x => x.ContractUnit)
            .HasColumnName("contract_unit").HasConversion<string>().HasMaxLength(20); // nullable enum -> stores "LumpSum"

        builder.Property(x => x.ContractQuantity).HasColumnName("contract_quantity");
        builder.Property(x => x.TotalCost).HasColumnName("total_cost");               // NULLABLE (no-multiply)
        builder.Property(x => x.LinkedActivityId).HasColumnName("linked_activity_id");
        builder.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc").IsRequired();

        // ── wave-3.12, spec Ruling 5 — certainty is a DIFFERENT AXIS from
        // provenance (doctrine P8), so it gets its own nullable columns rather than
        // overloading anything that already exists. Stored as the enum NAME, matching
        // every other enum on these tables, so the column reads honestly in psql.
        // NULL on every row written before this migration and on every row nobody was
        // asked about — never defaulted to Reported (P4).
        builder.Property(x => x.CostCertainty)
            .HasColumnName("cost_certainty").HasConversion<string>().HasMaxLength(20);
        builder.Property(x => x.CostSpokenText)
            .HasColumnName("cost_spoken_text").HasMaxLength(200);

        builder.HasIndex(x => x.DailyLogId).HasDatabaseName("ix_labour_assignments_daily_log_id");
        builder.Ignore(x => x.DomainEvents);
    }
}
