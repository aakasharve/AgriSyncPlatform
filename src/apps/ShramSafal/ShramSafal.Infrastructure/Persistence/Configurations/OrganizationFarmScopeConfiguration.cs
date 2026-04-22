using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Organizations;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class OrganizationFarmScopeConfiguration
    : IEntityTypeConfiguration<OrganizationFarmScope>
{
    public void Configure(EntityTypeBuilder<OrganizationFarmScope> builder)
    {
        builder.ToTable("organization_farm_scopes");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("id")
            .ValueGeneratedNever();

        builder.Property(x => x.OrganizationId)
            .HasColumnName("organization_id")
            .IsRequired();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        builder.Property(x => x.Source)
            .HasColumnName("source")
            .HasConversion<int>()
            .IsRequired();

        builder.Property(x => x.GrantedByUserId)
            .HasColumnName("granted_by_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.GrantedAtUtc)
            .HasColumnName("granted_at_utc")
            .IsRequired();

        builder.Property(x => x.IsActive)
            .HasColumnName("is_active")
            .IsRequired();

        builder.HasIndex(x => x.OrganizationId);
        builder.HasIndex(x => x.FarmId);

        // Partial unique index (active only) added via raw SQL in migration.

        builder.Ignore(x => x.DomainEvents);
    }
}
