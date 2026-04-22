using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Organizations;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class OrganizationMembershipConfiguration
    : IEntityTypeConfiguration<OrganizationMembership>
{
    public void Configure(EntityTypeBuilder<OrganizationMembership> builder)
    {
        builder.ToTable("organization_memberships");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("id")
            .ValueGeneratedNever();

        builder.Property(x => x.OrganizationId)
            .HasColumnName("organization_id")
            .IsRequired();

        builder.Property(x => x.UserId)
            .HasColumnName("user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.Role)
            .HasColumnName("role")
            .HasConversion<int>()
            .IsRequired();

        builder.Property(x => x.AddedByUserId)
            .HasColumnName("added_by_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.JoinedAtUtc)
            .HasColumnName("joined_at_utc")
            .IsRequired();

        builder.Property(x => x.IsActive)
            .HasColumnName("is_active")
            .IsRequired();

        builder.HasIndex(x => x.OrganizationId);
        builder.HasIndex(x => x.UserId);

        // Partial unique index (active only) added via raw SQL in migration.

        builder.Ignore(x => x.DomainEvents);
    }
}
