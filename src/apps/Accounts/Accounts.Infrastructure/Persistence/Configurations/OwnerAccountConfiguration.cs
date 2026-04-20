using Accounts.Domain.OwnerAccounts;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Accounts.Infrastructure.Persistence.Configurations;

internal sealed class OwnerAccountConfiguration : IEntityTypeConfiguration<OwnerAccount>
{
    public void Configure(EntityTypeBuilder<OwnerAccount> builder)
    {
        builder.ToTable("owner_accounts");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id)
            .HasColumnName("owner_account_id")
            .HasConversion(TypedIdConverters.OwnerAccountId);

        builder.Property(x => x.AccountName)
            .HasColumnName("account_name")
            .HasMaxLength(200)
            .IsRequired();

        builder.Property(x => x.PrimaryOwnerUserId)
            .HasColumnName("primary_owner_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.AccountType)
            .HasColumnName("account_type")
            .HasConversion<int>()
            .IsRequired();

        builder.Property(x => x.Status)
            .HasColumnName("status")
            .HasConversion<int>()
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.Property(x => x.ModifiedAtUtc)
            .HasColumnName("modified_at_utc")
            .IsRequired();

        builder.HasIndex(x => x.PrimaryOwnerUserId)
            .HasDatabaseName("ix_owner_accounts_primary_owner_user_id");

        // Domain events are not persisted — BuildingBlocks.Domain.Entity
        // exposes them for the UoW to drain before commit.
        builder.Ignore(x => x.DomainEvents);

        // Memberships are a nested collection on the aggregate root.
        builder.HasMany(x => x.Memberships)
            .WithOne()
            .HasForeignKey(m => m.OwnerAccountId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
