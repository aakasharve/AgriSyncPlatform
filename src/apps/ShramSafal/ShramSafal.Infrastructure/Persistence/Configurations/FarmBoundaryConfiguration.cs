using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class FarmBoundaryConfiguration : IEntityTypeConfiguration<FarmBoundary>
{
    public void Configure(EntityTypeBuilder<FarmBoundary> builder)
    {
        builder.ToTable("farm_boundaries");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("id")
            .ValueGeneratedNever();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        builder.Property(x => x.OwnerAccountId)
            .HasColumnName("owner_account_id")
            .HasConversion(TypedIdConverters.OwnerAccountId)
            .IsRequired();

        builder.Property(x => x.PolygonGeoJson)
            .HasColumnName("polygon_geo_json")
            .HasColumnType("jsonb")
            .IsRequired();

        builder.Property(x => x.CalculatedAreaAcres)
            .HasColumnName("calculated_area_acres")
            .HasPrecision(18, 4)
            .IsRequired();

        builder.Property(x => x.Source)
            .HasColumnName("source")
            .HasConversion<string>()
            .HasMaxLength(40)
            .IsRequired();

        builder.Property(x => x.Version)
            .HasColumnName("version")
            .IsRequired();

        builder.Property(x => x.IsActive)
            .HasColumnName("is_active")
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.Property(x => x.ArchivedAtUtc)
            .HasColumnName("archived_at_utc");

        builder.HasIndex(x => new { x.OwnerAccountId, x.FarmId })
            .HasDatabaseName("ix_farm_boundaries_owner_account_id_farm_id");

        builder.HasIndex(x => new { x.FarmId, x.IsActive })
            .HasDatabaseName("ix_farm_boundaries_farm_id_is_active");

        builder.HasIndex(x => x.FarmId)
            .IsUnique()
            .HasDatabaseName("ux_farm_boundaries_active_farm_id")
            .HasFilter("is_active = TRUE");

        builder.HasOne<Farm>()
            .WithMany()
            .HasForeignKey(x => x.FarmId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Ignore(x => x.DomainEvents);
    }
}
