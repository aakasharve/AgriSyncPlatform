using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class FarmOperationConfiguration : IEntityTypeConfiguration<FarmOperation>
{
    public void Configure(EntityTypeBuilder<FarmOperation> builder)
    {
        builder.ToTable("farm_operations");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id").HasConversion(TypedIdConverters.FarmId).IsRequired();

        builder.Property(x => x.PlotId).HasColumnName("plot_id"); // nullable Guid?

        builder.Property(x => x.OperationType)
            .HasColumnName("operation_type").HasMaxLength(60).IsRequired();

        builder.Property(x => x.OperationDate)
            .HasColumnName("operation_date").IsRequired(); // DateOnly -> date

        builder.Property(x => x.SourceDailyLogId).HasColumnName("source_daily_log_id");

        builder.Property(x => x.DerivedEventKey)
            .HasColumnName("derived_event_key").HasMaxLength(64).IsRequired()
            .HasConversion(k => k.Value, v => new DerivedEventKey(v));

        builder.Property(x => x.IsCurrentVersion).HasColumnName("is_current_version").IsRequired();
        builder.Property(x => x.SupersededByOperationId).HasColumnName("superseded_by_operation_id");
        builder.Property(x => x.DistrictCode).HasColumnName("district_code").HasMaxLength(20);
        builder.Property(x => x.DialectRegion).HasColumnName("dialect_region").HasMaxLength(40);

        builder.Property(x => x.CreatedByUserId)
            .HasColumnName("created_by_user_id").HasConversion(TypedIdConverters.UserId).IsRequired();

        builder.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc").IsRequired();
        builder.Property(x => x.ModifiedAtUtc).HasColumnName("modified_at_utc").IsRequired();

        builder.OwnsOne(x => x.Provenance, p => p.ConfigureProvenance());
        builder.Navigation(x => x.Provenance).IsRequired();

        builder.HasIndex(x => x.FarmId).HasDatabaseName("ix_farm_operations_farm_id");
        builder.HasIndex(x => x.SourceDailyLogId).HasDatabaseName("ix_farm_operations_source_daily_log_id");
        // Supersede-or-no-op invariant DB-enforced: at most one CURRENT row per key per farm.
        builder.HasIndex(x => new { x.FarmId, x.DerivedEventKey })
            .HasFilter("is_current_version")
            .IsUnique()
            .HasDatabaseName("ix_farm_operations_current_key");

        builder.Ignore(x => x.DomainEvents);
    }
}
