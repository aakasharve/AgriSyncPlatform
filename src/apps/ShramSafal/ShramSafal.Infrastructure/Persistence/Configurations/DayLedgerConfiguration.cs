using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Finance;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class DayLedgerConfiguration : IEntityTypeConfiguration<DayLedger>
{
    public void Configure(EntityTypeBuilder<DayLedger> builder)
    {
        builder.ToTable("day_ledgers");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        builder.Property(x => x.DateKey)
            .HasColumnName("date_key")
            .IsRequired();

        builder.Property(x => x.GlobalExpenseIds)
            .HasColumnName("global_expense_ids")
            .HasColumnType("uuid[]")
            .IsRequired();

        builder.Property(x => x.AllocationStrategy)
            .HasColumnName("allocation_strategy")
            .HasConversion<string>()
            .HasMaxLength(32)
            .IsRequired();

        builder.Property(x => x.TotalGlobalCost)
            .HasColumnName("total_global_cost")
            .HasPrecision(18, 2)
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.OwnsMany(x => x.PlotAllocations, owned =>
        {
            owned.ToTable("day_ledger_plot_allocations");

            owned.WithOwner()
                .HasForeignKey("day_ledger_id");

            owned.Property<int>("id");
            owned.HasKey("id");

            owned.Property(x => x.PlotId)
                .HasColumnName("plot_id")
                .IsRequired();

            owned.Property(x => x.CropCycleId)
                .HasColumnName("crop_cycle_id")
                .IsRequired();

            owned.Property(x => x.AllocationPercent)
                .HasColumnName("allocation_percent")
                .HasPrecision(8, 2)
                .IsRequired();

            owned.Property(x => x.AllocatedAmount)
                .HasColumnName("allocated_amount")
                .HasPrecision(18, 2)
                .IsRequired();
        });

        builder.HasIndex(x => new { x.FarmId, x.DateKey })
            .IsUnique();

        builder.Ignore(x => x.DomainEvents);
    }
}
