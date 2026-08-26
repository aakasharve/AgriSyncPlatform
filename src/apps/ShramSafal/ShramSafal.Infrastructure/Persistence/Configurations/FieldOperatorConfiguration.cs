using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Labour;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class FieldOperatorConfiguration : IEntityTypeConfiguration<FieldOperator>
{
    public void Configure(EntityTypeBuilder<FieldOperator> builder)
    {
        builder.ToTable("field_operators");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.DisplayName)
            .HasColumnName("display_name")
            .HasMaxLength(200)
            .IsRequired();

        // Search/suggestion index only — never a uniqueness or matching key
        // (see FieldOperator class remarks; WorkerNameProjector find-or-create
        // defect this must not repeat).
        builder.Property(x => x.DisplayNameNormalized)
            .HasColumnName("display_name_normalized")
            .HasMaxLength(200)
            .IsRequired();

        builder.Property(x => x.FullName)
            .HasColumnName("full_name")
            .HasMaxLength(200);

        builder.Property(x => x.OriginatingFarmId)
            .HasColumnName("originating_farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        builder.Property(x => x.CreatedByUserId)
            .HasColumnName("created_by_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.Property(x => x.IsActive)
            .HasColumnName("is_active")
            .IsRequired();

        // Deliberate divergence from ssf.workers -> ssf.farms (CASCADE):
        // deleting a farm must fail while field-operator identities exist
        // rather than silently erasing people. Precedent: CostEntryConfiguration
        // (CategoryId -> CostCategory, DeleteBehavior.Restrict).
        builder.HasOne<Farm>()
            .WithMany()
            .HasForeignKey(x => x.OriginatingFarmId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(x => x.OriginatingFarmId)
            .HasDatabaseName("ix_field_operators_originating_farm_id");

        builder.Ignore(x => x.DomainEvents);
    }
}
