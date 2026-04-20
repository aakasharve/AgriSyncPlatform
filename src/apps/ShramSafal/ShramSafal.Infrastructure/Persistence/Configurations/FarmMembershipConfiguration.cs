using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class FarmMembershipConfiguration : IEntityTypeConfiguration<FarmMembership>
{
    public void Configure(EntityTypeBuilder<FarmMembership> builder)
    {
        builder.ToTable("farm_memberships");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        builder.Property(x => x.UserId)
            .HasColumnName("user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.Role)
            .HasColumnName("role")
            .HasConversion<string>()
            .HasMaxLength(30)
            .IsRequired();

        builder.Property(x => x.GrantedAtUtc)
            .HasColumnName("granted_at_utc")
            .IsRequired();

        builder.Property(x => x.ModifiedAtUtc)
            .HasColumnName("modified_at_utc")
            .IsRequired();

        // Legacy column preserved. New code reads Status but the column
        // is kept (and kept in sync via IsRevoked getter) so old
        // integration queries and sync diffs do not change shape.
        builder.Ignore(x => x.IsRevoked);
        builder.Ignore(x => x.IsActive);
        builder.Ignore(x => x.IsTerminal);

        builder.Property(x => x.RevokedAtUtc)
            .HasColumnName("revoked_at_utc");

        // Phase 2 state-machine fields (plan §8.5.1).
        builder.Property(x => x.Status)
            .HasColumnName("status")
            .HasConversion<int>()
            .HasDefaultValue(MembershipStatus.Active)
            .IsRequired();

        builder.Property(x => x.JoinedVia)
            .HasColumnName("joined_via")
            .HasConversion<int>()
            .HasDefaultValue(JoinedVia.PrimaryOwnerBootstrap)
            .IsRequired();

        builder.Property(x => x.InvitationId)
            .HasColumnName("invitation_id")
            .HasConversion(
                v => v == null ? (Guid?)null : v.Value.Value,
                v => v == null ? null : new AgriSync.SharedKernel.Contracts.Ids.FarmInvitationId(v.Value));

        builder.Property(x => x.ApprovedByUserId)
            .HasColumnName("approved_by_user_id")
            .HasConversion(
                v => v == null ? (Guid?)null : v.Value.Value,
                v => v == null ? null : new AgriSync.SharedKernel.Contracts.Ids.UserId(v.Value));

        builder.Property(x => x.LastSeenAtUtc)
            .HasColumnName("last_seen_at_utc");

        builder.Property(x => x.ExitedAtUtc)
            .HasColumnName("exited_at_utc");

        builder.HasIndex(x => x.FarmId);
        builder.HasIndex(x => x.UserId);

        // Preserve the historical partial unique index on is_revoked so
        // existing callers that still read the column do not break. The
        // new Status-aware unique index is added by the migration.
        builder.HasIndex(x => new { x.FarmId, x.UserId })
            .HasDatabaseName("ix_farm_memberships_farm_user_nonterminal")
            .HasFilter("status NOT IN (5, 6)") // 5 = Revoked, 6 = Exited
            .IsUnique();

        builder.Ignore(x => x.DomainEvents);
    }
}
