using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class FarmConfiguration : IEntityTypeConfiguration<Farm>
{
    public void Configure(EntityTypeBuilder<Farm> builder)
    {
        builder.ToTable("farms");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasConversion(TypedIdConverters.FarmId)
            .ValueGeneratedNever();

        builder.Property(x => x.Name)
            .HasColumnName("name")
            .HasMaxLength(120)
            .IsRequired();

        builder.Property(x => x.OwnerUserId)
            .HasColumnName("owner_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.Property(x => x.ModifiedAtUtc)
            .HasColumnName("modified_at_utc")
            .IsRequired();

        builder.Property(x => x.CanonicalCentreLat)
            .HasColumnName("canonical_centre_lat")
            .HasPrecision(10, 7);

        builder.Property(x => x.CanonicalCentreLng)
            .HasColumnName("canonical_centre_lng")
            .HasPrecision(10, 7);

        builder.Property(x => x.CentreSource)
            .HasColumnName("centre_source")
            .HasConversion<string>()
            .HasMaxLength(40);

        builder.Property(x => x.WeatherRadiusKm)
            .HasColumnName("weather_radius_km")
            .HasPrecision(8, 3)
            .HasDefaultValue(3.0)
            .IsRequired();

        builder.Property(x => x.TotalMappedAreaAcres)
            .HasColumnName("total_mapped_area_acres")
            .HasPrecision(18, 4);

        builder.Property(x => x.TotalGovtAreaAcres)
            .HasColumnName("total_govt_area_acres")
            .HasPrecision(18, 4);

        builder.Property(x => x.GeoValidationStatus)
            .HasColumnName("geo_validation_status")
            .HasConversion<string>()
            .HasMaxLength(40)
            .HasDefaultValue(GeoValidationStatus.Unchecked)
            .IsRequired();

        // Phase 2 multi-tenant fields. NOT NULL post-backfill (invariant I5).
        builder.Property(x => x.OwnerAccountId)
            .HasColumnName("owner_account_id")
            .HasConversion(TypedIdConverters.OwnerAccountId)
            .IsRequired();

        builder.Property(x => x.FarmCode)
            .HasColumnName("farm_code")
            .HasMaxLength(12);

        builder.HasIndex(x => x.ModifiedAtUtc);
        builder.HasIndex(x => x.OwnerAccountId)
            .HasDatabaseName("ix_farms_owner_account_id");
        builder.HasIndex(x => new { x.OwnerAccountId, x.Id })
            .HasDatabaseName("ix_farms_owner_account_id_id");
        builder.HasIndex(x => x.FarmCode)
            .IsUnique()
            .HasDatabaseName("ux_farms_farm_code")
            .HasFilter("farm_code IS NOT NULL");

        builder.Ignore(x => x.DomainEvents);
    }
}
