using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class MachineryUsageConfiguration : IEntityTypeConfiguration<MachineryUsage>
{
    public void Configure(EntityTypeBuilder<MachineryUsage> builder)
    {
        builder.ToTable("machinery_usages");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.DailyLogId).HasColumnName("daily_log_id").IsRequired();

        builder.Property(x => x.MachineType)
            .HasColumnName("machine_type").HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(x => x.Ownership)
            .HasColumnName("ownership").HasConversion<string>().HasMaxLength(20).IsRequired();

        builder.Property(x => x.HoursUsed).HasColumnName("hours_used");
        builder.Property(x => x.RentalCost).HasColumnName("rental_cost");
        builder.Property(x => x.FuelCost).HasColumnName("fuel_cost");

        builder.Property(x => x.Implement).HasColumnName("implement").HasMaxLength(40);
        builder.Property(x => x.NozzlesActive).HasColumnName("nozzles_active");
        builder.Property(x => x.FanState)
            .HasColumnName("fan_state").HasConversion<string>().HasMaxLength(10); // nullable enum -> stores "On"/"Off"
        builder.Property(x => x.FuelType).HasColumnName("fuel_type").HasMaxLength(40);
        builder.Property(x => x.FuelQuantity).HasColumnName("fuel_quantity");
        builder.Property(x => x.OperationPerformed).HasColumnName("operation_performed").HasMaxLength(80);

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

        builder.HasIndex(x => x.DailyLogId).HasDatabaseName("ix_machinery_usages_daily_log_id");
        builder.Ignore(x => x.DomainEvents);
    }
}
