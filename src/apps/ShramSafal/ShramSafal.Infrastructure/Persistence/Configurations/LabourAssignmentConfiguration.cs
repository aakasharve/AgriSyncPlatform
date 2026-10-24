using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Labour;

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

        // Task 4 — duration always travels with its provenance (LabourTime). 'Unspecified'
        // is 11 chars, hence varchar(12) not the usual (20) seen elsewhere in this file.
        builder.Property(x => x.DurationHours).HasColumnName("duration_hours").IsRequired();
        builder.Property(x => x.TimeBasis)
            .HasColumnName("time_basis").HasConversion<string>().HasMaxLength(12).IsRequired();

        builder.Property(x => x.Shift)
            .HasColumnName("shift").HasConversion<string>().HasMaxLength(20); // nullable enum -> stores "Full"/"Half"/"Night"

        builder.Property(x => x.Task).HasColumnName("task");                          // nullable free text

        // LABOUR_PHASE2 migration ③ (founder decision O-3) — the farmer's own note.
        // No max length, exactly like `task` above: this is the farmer's words, and
        // a length cap here would silently truncate them. NULL = no note (the domain
        // normalises blank to null), never an empty string.
        builder.Property(x => x.Notes).HasColumnName("notes");

        // Final direction §3 — the crew link (Phase 0 UNKNOWN 1). The schema's
        // FIRST nullable FK: NULL = "nobody said through whom", never "no
        // mukadam". Real FK + Restrict (NOT the linked_activity_id precedent:
        // client uuid, no FK, no validation) because FK checks bypass RLS and
        // the tenant WITH CHECK is (true) — the application farm guard in
        // CreateDailyLogHandler is the tenant boundary here. No GRANT
        // (privileges are per-table), no RLS change (policies name tables).
        builder.Property(x => x.EngagedThroughFieldOperatorId)
            .HasColumnName("engaged_through_field_operator_id");

        builder.HasIndex(x => x.EngagedThroughFieldOperatorId)
            .HasDatabaseName("ix_labour_assignments_engaged_through");

        builder.HasOne<FieldOperator>()
            .WithMany()
            .HasForeignKey(x => x.EngagedThroughFieldOperatorId)
            .OnDelete(DeleteBehavior.Restrict);

        // Task 2.2 — mirrors DailyLogConfiguration.EvidenceSourcesJson: ships NOT NULL
        // with default '[]'::jsonb so the column never needs NULL handling downstream.
        builder.Property(x => x.WorkerNamesJson)
            .HasColumnName("worker_names_json")
            .HasColumnType("jsonb")
            .HasDefaultValueSql("'[]'::jsonb")
            .IsRequired();

        // ── wave-3.12, spec Ruling 5 — certainty is a DIFFERENT AXIS from
        // provenance (doctrine P8), so it gets its own nullable columns rather than
        // overloading anything that already exists. Stored as the enum NAME, matching
        // every other enum on these tables, so the column reads honestly in psql.
        // NULL on every row written before this migration and on every row nobody was
        // asked about — never defaulted to Reported (P4).
        // Mirrors MachineryUsageConfiguration exactly; the columns already exist from
        // 20260816155627_AddNumericCertainty, which created BOTH tables' pairs.
        builder.Property(x => x.CostCertainty)
            .HasColumnName("cost_certainty").HasConversion<string>().HasMaxLength(20);
        builder.Property(x => x.CostSpokenText)
            .HasColumnName("cost_spoken_text").HasMaxLength(200);

        builder.HasIndex(x => x.DailyLogId).HasDatabaseName("ix_labour_assignments_daily_log_id");

        // Task 1 (spec 2026-07-13-labour-attendance-approval-design) — parent
        // integrity on the anchor. Shadow FK (neither side has a navigation
        // property), same idiom as CostEntryConfiguration's CategoryId FK.
        builder.HasOne<ShramSafal.Domain.Logs.DailyLog>()
            .WithMany()
            .HasForeignKey(x => x.DailyLogId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Ignore(x => x.DomainEvents);
    }
}
