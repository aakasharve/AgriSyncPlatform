using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class FarmInvitationConfiguration : IEntityTypeConfiguration<FarmInvitation>
{
    public void Configure(EntityTypeBuilder<FarmInvitation> builder)
    {
        builder.ToTable("farm_invitations");
        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("farm_invitation_id")
            .HasConversion(TypedIdConverters.FarmInvitationId)
            .ValueGeneratedNever();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        builder.Property(x => x.CreatedByUserId)
            .HasColumnName("created_by_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.Status)
            .HasColumnName("status")
            .HasConversion<int>()
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc").IsRequired();
        builder.Property(x => x.RevokedAtUtc).HasColumnName("revoked_at_utc");

        // Exactly one Active invitation per farm at any time. Plan §5.3
        // simplified: rotate = revoke old + create new, atomically.
        builder.HasIndex(x => x.FarmId)
            .HasDatabaseName("ux_farm_invitations_active_per_farm")
            .IsUnique()
            .HasFilter("status = 1"); // 1 == Active

        builder.Ignore(x => x.DomainEvents);
    }
}
