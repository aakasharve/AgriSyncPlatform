using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class FarmJoinTokenConfiguration : IEntityTypeConfiguration<FarmJoinToken>
{
    public void Configure(EntityTypeBuilder<FarmJoinToken> builder)
    {
        builder.ToTable("farm_join_tokens");
        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("farm_join_token_id")
            .HasConversion(TypedIdConverters.FarmJoinTokenId)
            .ValueGeneratedNever();

        builder.Property(x => x.InvitationId)
            .HasColumnName("farm_invitation_id")
            .HasConversion(TypedIdConverters.FarmInvitationId)
            .IsRequired();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        // Raw token (plaintext-at-rest; encryption-at-rest deferred to
        // Phase 8 hardening).
        builder.Property(x => x.RawToken)
            .HasColumnName("raw_token")
            .HasMaxLength(128)
            .IsRequired();

        // SHA-256 hex = 64 chars. DB lookup is on this column so it must
        // be uniquely indexed for O(1) claim-path reads.
        builder.Property(x => x.TokenHash)
            .HasColumnName("token_hash")
            .HasMaxLength(64)
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc").IsRequired();
        builder.Property(x => x.IsRevoked).HasColumnName("is_revoked").HasDefaultValue(false).IsRequired();
        builder.Property(x => x.RevokedAtUtc).HasColumnName("revoked_at_utc");

        builder.HasIndex(x => x.TokenHash)
            .HasDatabaseName("ux_farm_join_tokens_token_hash")
            .IsUnique();

        builder.HasIndex(x => x.FarmId)
            .HasDatabaseName("ix_farm_join_tokens_farm_id");

        builder.Ignore(x => x.DomainEvents);
    }
}
