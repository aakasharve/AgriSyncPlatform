using Accounts.Domain.OwnerAccounts;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Accounts.Infrastructure.Persistence.Configurations;

internal sealed class OwnerAccountMembershipConfiguration : IEntityTypeConfiguration<OwnerAccountMembership>
{
    public void Configure(EntityTypeBuilder<OwnerAccountMembership> builder)
    {
        builder.ToTable("owner_account_memberships");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id)
            .HasColumnName("owner_account_membership_id")
            .HasConversion(TypedIdConverters.OwnerAccountMembershipId);

        builder.Property(x => x.OwnerAccountId)
            .HasColumnName("owner_account_id")
            .HasConversion(TypedIdConverters.OwnerAccountId)
            .IsRequired();

        builder.Property(x => x.UserId)
            .HasColumnName("user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.Role)
            .HasColumnName("role")
            .HasConversion<int>()
            .IsRequired();

        builder.Property(x => x.Status)
            .HasColumnName("status")
            .HasConversion<int>()
            .IsRequired();

        builder.Property(x => x.InvitedByUserId)
            .HasColumnName("invited_by_user_id")
            .HasConversion(
                v => v == null ? (Guid?)null : v.Value.Value,
                v => v == null ? null : new AgriSync.SharedKernel.Contracts.Ids.UserId(v.Value));

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.Property(x => x.ModifiedAtUtc)
            .HasColumnName("modified_at_utc")
            .IsRequired();

        builder.Property(x => x.EndedAtUtc)
            .HasColumnName("ended_at_utc");

        builder.HasIndex(x => new { x.OwnerAccountId, x.UserId })
            .HasDatabaseName("ix_owner_account_memberships_account_user")
            .HasFilter("status <> 3"); // Not Revoked

        builder.Ignore(x => x.DomainEvents);
    }
}
