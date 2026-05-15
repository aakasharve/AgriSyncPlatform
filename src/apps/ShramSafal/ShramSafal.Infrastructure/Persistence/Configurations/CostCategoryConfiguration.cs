using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Finance;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// DATA_PRINCIPLE_SPINE sub-phase 02.5 — server-owned cost-category lookup.
/// Parity with <see cref="TranscriptConfiguration"/>: <c>internal sealed</c>,
/// snake_case columns, no schema annotation (the default <c>ssf</c> schema
/// is applied by <see cref="ShramSafalDbContext.OnModelCreating"/>).
/// </summary>
internal sealed class CostCategoryConfiguration : IEntityTypeConfiguration<CostCategory>
{
    public void Configure(EntityTypeBuilder<CostCategory> b)
    {
        b.ToTable("cost_categories");
        b.HasKey(x => x.Id);

        b.Property(x => x.Id)
            .HasColumnName("id")
            .HasMaxLength(48)
            .IsRequired()
            .ValueGeneratedNever();

        b.Property(x => x.DisplayMr)
            .HasColumnName("display_mr")
            .HasMaxLength(80)
            .IsRequired();

        b.Property(x => x.DisplayHi)
            .HasColumnName("display_hi")
            .HasMaxLength(80)
            .IsRequired();

        b.Property(x => x.DisplayEn)
            .HasColumnName("display_en")
            .HasMaxLength(80)
            .IsRequired();

        b.Property(x => x.IsActive)
            .HasColumnName("is_active")
            .HasDefaultValue(true)
            .IsRequired();
    }
}
