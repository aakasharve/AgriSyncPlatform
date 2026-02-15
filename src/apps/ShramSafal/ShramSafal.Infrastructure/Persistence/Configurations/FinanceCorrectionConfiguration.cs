using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Finance;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class FinanceCorrectionConfiguration : IEntityTypeConfiguration<FinanceCorrection>
{
    public void Configure(EntityTypeBuilder<FinanceCorrection> builder)
    {
        builder.ToTable("finance_corrections");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.CostEntryId)
            .HasColumnName("cost_entry_id")
            .IsRequired();

        builder.Property(x => x.OriginalAmount)
            .HasColumnName("original_amount")
            .HasPrecision(18, 2)
            .IsRequired();

        builder.Property(x => x.CorrectedAmount)
            .HasColumnName("corrected_amount")
            .HasPrecision(18, 2)
            .IsRequired();

        builder.Property(x => x.CurrencyCode)
            .HasColumnName("currency_code")
            .HasMaxLength(8)
            .IsRequired();

        builder.Property(x => x.Reason)
            .HasColumnName("reason")
            .HasMaxLength(400)
            .IsRequired();

        builder.Property(x => x.CorrectedByUserId)
            .HasColumnName("corrected_by_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.CorrectedAtUtc)
            .HasColumnName("corrected_at_utc")
            .IsRequired();

        builder.HasIndex(x => new { x.CostEntryId, x.CorrectedAtUtc });
        builder.Ignore(x => x.DomainEvents);
    }
}
