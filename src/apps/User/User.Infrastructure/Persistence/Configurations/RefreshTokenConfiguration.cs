using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using User.Domain.Security;

namespace User.Infrastructure.Persistence.Configurations;

internal sealed class RefreshTokenConfiguration : IEntityTypeConfiguration<RefreshToken>
{
    public void Configure(EntityTypeBuilder<RefreshToken> builder)
    {
        builder.ToTable("refresh_tokens");

        builder.HasKey(t => t.Id);

        builder.Property(t => t.Id)
            .ValueGeneratedNever();

        builder.Property(t => t.UserId)
            .HasColumnName("user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(t => t.TokenHash)
            .HasColumnName("token_hash")
            .HasMaxLength(128)
            .IsRequired();

        builder.Property(t => t.DeviceId)
            .HasColumnName("device_id")
            .HasMaxLength(128)
            .IsRequired();

        builder.Property(t => t.DeviceName)
            .HasColumnName("device_name")
            .HasMaxLength(160);

        builder.Property(t => t.Platform)
            .HasColumnName("platform")
            .HasMaxLength(32)
            .IsRequired();

        builder.Property(t => t.CreatedAtUtc)
            .HasColumnName("created_at_utc");

        builder.Property(t => t.ExpiresAtUtc)
            .HasColumnName("expires_at_utc");

        builder.Property(t => t.LastUsedAtUtc)
            .HasColumnName("last_used_at_utc");

        builder.Property(t => t.RevokedAtUtc)
            .HasColumnName("revoked_at_utc");

        builder.Property(t => t.RevocationReason)
            .HasColumnName("revocation_reason")
            .HasMaxLength(64);

        builder.Property(t => t.ReplacedByTokenId)
            .HasColumnName("replaced_by_token_id");

        builder.HasIndex(t => t.TokenHash)
            .IsUnique();

        builder.HasIndex(t => new { t.UserId, t.DeviceId });

        builder.HasIndex(t => new { t.UserId, t.RevokedAtUtc });

        builder.Ignore(t => t.DomainEvents);
    }
}
