using Accounts.Domain.Subscriptions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Accounts.Infrastructure.Persistence.Configurations;

internal sealed class SubscriptionConfiguration : IEntityTypeConfiguration<Subscription>
{
    public void Configure(EntityTypeBuilder<Subscription> builder)
    {
        builder.ToTable("subscriptions");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id)
            .HasColumnName("subscription_id")
            .HasConversion(TypedIdConverters.SubscriptionId);

        builder.Property(x => x.OwnerAccountId)
            .HasColumnName("owner_account_id")
            .HasConversion(TypedIdConverters.OwnerAccountId)
            .IsRequired();

        builder.Property(x => x.PlanCode)
            .HasColumnName("plan_code")
            .HasMaxLength(64)
            .IsRequired();

        builder.Property(x => x.Status)
            .HasColumnName("status")
            .HasConversion<int>()
            .IsRequired();

        builder.Property(x => x.ValidFromUtc)
            .HasColumnName("valid_from_utc")
            .IsRequired();

        builder.Property(x => x.ValidUntilUtc)
            .HasColumnName("valid_until_utc")
            .IsRequired();

        builder.Property(x => x.TrialEndsAtUtc)
            .HasColumnName("trial_ends_at_utc");

        builder.Property(x => x.BillingProviderCustomerId)
            .HasColumnName("billing_provider_customer_id")
            .HasMaxLength(128);

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.Property(x => x.UpdatedAtUtc)
            .HasColumnName("updated_at_utc")
            .IsRequired();

        // Invariant I6 — at most one Trialing/Active subscription per
        // OwnerAccount at any time. Partial unique index on
        // status IN (1, 2) == Trialing, Active.
        builder.HasIndex(x => x.OwnerAccountId)
            .HasDatabaseName("ux_subscriptions_owner_account_active")
            .IsUnique()
            .HasFilter("status IN (1, 2)");

        builder.Ignore(x => x.DomainEvents);
    }
}
