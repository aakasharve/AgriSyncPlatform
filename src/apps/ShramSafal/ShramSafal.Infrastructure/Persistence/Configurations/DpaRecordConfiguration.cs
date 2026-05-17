// spec: data-principle-spine-2026-05-05/05.5
using ShramSafal.Domain.Privacy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 05 sub-phase 05.5 — EF mapping for
/// <see cref="DpaRecord"/>. Snake-case columns, default <c>ssf</c>
/// schema (applied via <c>ShramSafalDbContext.OnModelCreating</c>).
/// Max-lengths per plan §05.5.1; <c>signed_date</c> is the only
/// nullable column per OQ-4 (pending-row semantic).
/// </summary>
internal sealed class DpaRecordConfiguration : IEntityTypeConfiguration<DpaRecord>
{
    public void Configure(EntityTypeBuilder<DpaRecord> b)
    {
        b.ToTable("dpa_registry");
        b.HasKey(x => x.Id);

        b.Property(x => x.Id)
            .HasColumnName("id")
            .IsRequired();

        b.Property(x => x.VendorName)
            .HasColumnName("vendor_name")
            .HasMaxLength(128)
            .IsRequired();

        b.Property(x => x.ContractPath)
            .HasColumnName("contract_path")
            .HasMaxLength(512)
            .IsRequired();

        // OQ-4: nullable so PENDING rows (no signed PDF yet) round-trip
        // cleanly through EF without sentinel-date hacks.
        b.Property(x => x.SignedDate)
            .HasColumnName("signed_date")
            .IsRequired(false);

        b.Property(x => x.Scope)
            .HasColumnName("scope")
            .HasMaxLength(256)
            .IsRequired();

        b.Property(x => x.Region)
            .HasColumnName("region")
            .HasMaxLength(32)
            .IsRequired();

        b.Property(x => x.ContactEmail)
            .HasColumnName("contact_email")
            .HasMaxLength(128)
            .IsRequired();

        b.Property(x => x.IsActive)
            .HasColumnName("is_active")
            .IsRequired();
    }
}
