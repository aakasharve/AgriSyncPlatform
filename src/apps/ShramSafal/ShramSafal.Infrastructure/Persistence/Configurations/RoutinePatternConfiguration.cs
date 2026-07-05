using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class RoutinePatternConfiguration : IEntityTypeConfiguration<RoutinePattern>
{
    public void Configure(EntityTypeBuilder<RoutinePattern> builder)
    {
        builder.ToTable("routine_patterns");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.FarmId).HasColumnName("farm_id").IsRequired();   // plain Guid, direct tenancy key
        builder.Property(x => x.PlotId).HasColumnName("plot_id");                // nullable

        builder.Property(x => x.OperationType).HasColumnName("operation_type").HasMaxLength(60).IsRequired();
        builder.Property(x => x.TypicalDurationHours).HasColumnName("typical_duration_hours");   // numeric nullable
        builder.Property(x => x.TypicalMethod).HasColumnName("typical_method").HasMaxLength(40);  // nullable
        builder.Property(x => x.TypicalSource).HasColumnName("typical_source").HasMaxLength(40);  // nullable
        builder.Property(x => x.SampleCount).HasColumnName("sample_count").IsRequired();
        builder.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc").IsRequired();
        builder.Property(x => x.UpdatedAtUtc).HasColumnName("updated_at_utc").IsRequired();

        builder.HasIndex(x => x.FarmId).HasDatabaseName("ix_routine_patterns_farm_id");

        // ai-intelligence-plan-2026-06-25 — enforce the natural key
        // (farm_id, plot_id, operation_type) that UpsertRoutineAsync already
        // treats as unique (GetRoutinePatternAsync matches on all three). Two
        // concurrent first-confirms of the same routine could otherwise insert
        // duplicate rows. plot_id is nullable and Postgres treats NULLs as
        // DISTINCT in a plain unique index, so a single index would NOT dedupe
        // farm-wide (plot_id IS NULL) patterns. Split into two PARTIAL unique
        // indexes so both the plot-specific and the farm-wide cases are gated,
        // matching the repository's `p.PlotId == plotId` (→ IS NULL) semantics.
        builder.HasIndex(x => new { x.FarmId, x.PlotId, x.OperationType })
            .IsUnique()
            .HasDatabaseName("ux_routine_patterns_farm_plot_op")
            .HasFilter("plot_id IS NOT NULL");

        builder.HasIndex(x => new { x.FarmId, x.OperationType })
            .IsUnique()
            .HasDatabaseName("ux_routine_patterns_farm_op_no_plot")
            .HasFilter("plot_id IS NULL");

        builder.Ignore(x => x.DomainEvents);
    }
}
