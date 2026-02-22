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

        builder.Property(x => x.SourceCostEntryId)
            .HasColumnName("source_cost_entry_id")
            .IsRequired();

        builder.Property(x => x.LedgerDate)
            .HasColumnName("ledger_date")
            .IsRequired();

        builder.Property(x => x.AllocationBasis)
            .HasColumnName("allocation_basis")
            .HasMaxLength(40)
            .IsRequired();

        builder.Property(x => x.CreatedByUserId)
            .HasColumnName("created_by_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.Property(x => x.ModifiedAtUtc)
            .HasColumnName("modified_at_utc")
            .IsRequired();

        builder.OwnsMany(x => x.Allocations, allocation =>
        {
            allocation.ToTable("day_ledger_allocations");
            allocation.WithOwner().HasForeignKey("day_ledger_id");

            allocation.HasKey(x => x.Id);

            allocation.Property(x => x.Id)
                .HasColumnName("id")
                .ValueGeneratedNever();

            allocation.Property(x => x.PlotId)
                .HasColumnName("plot_id")
                .IsRequired();

            allocation.Property(x => x.AllocatedAmount)
                .HasColumnName("allocated_amount")
                .HasPrecision(18, 2)
                .IsRequired();

            allocation.Property(x => x.CurrencyCode)
                .HasColumnName("currency_code")
                .HasMaxLength(8)
                .IsRequired();

            allocation.Property(x => x.AllocatedAtUtc)
                .HasColumnName("allocated_at_utc")
                .IsRequired();

            allocation.HasIndex(x => x.PlotId);
            allocation.HasIndex(x => x.AllocatedAtUtc);
        });
        builder.Navigation(x => x.Allocations).UsePropertyAccessMode(PropertyAccessMode.Field);

        builder.HasIndex(x => new { x.FarmId, x.LedgerDate });
        builder.HasIndex(x => x.SourceCostEntryId).IsUnique();
        builder.HasIndex(x => x.ModifiedAtUtc);

        builder.Ignore(x => x.DomainEvents);
    }
}
