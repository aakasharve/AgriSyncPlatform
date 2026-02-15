using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using User.Domain.Membership;

namespace User.Infrastructure.Persistence.Configurations;

internal sealed class AppMembershipConfiguration : IEntityTypeConfiguration<AppMembership>
{
    public void Configure(EntityTypeBuilder<AppMembership> builder)
    {
        builder.ToTable("memberships");

        builder.HasKey(m => m.Id);

        builder.Property(m => m.Id)
            .ValueGeneratedNever();

        builder.Property(m => m.UserId)
            .HasColumnName("user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(m => m.AppId)
            .HasColumnName("app_id")
            .HasMaxLength(50)
            .IsRequired();

        builder.Property(m => m.Role)
            .HasColumnName("role")
            .HasConversion<string>()
            .HasMaxLength(30);

        builder.Property(m => m.GrantedAtUtc)
            .HasColumnName("granted_at_utc");

        builder.Property(m => m.IsRevoked)
            .HasColumnName("is_revoked")
            .HasDefaultValue(false);

        builder.HasIndex(m => new { m.UserId, m.AppId })
            .HasFilter("is_revoked = false")
            .IsUnique();

        builder.Ignore(m => m.DomainEvents);
    }
}
