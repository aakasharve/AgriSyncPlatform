using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Subscriptions;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class SubscriptionProjectionConfiguration : IEntityTypeConfiguration<SubscriptionProjection>
{
    public void Configure(EntityTypeBuilder<SubscriptionProjection> builder)
    {
        builder.ToView("subscription_projections", schema: "ssf");
        builder.HasKey(x => x.SubscriptionId);

        builder.Property(x => x.SubscriptionId)
            .HasColumnName("subscription_id")
            .HasConversion(
                v => v.Value,
                v => new AgriSync.SharedKernel.Contracts.Ids.SubscriptionId(v));

        builder.Property(x => x.OwnerAccountId)
            .HasColumnName("owner_account_id")
            .HasConversion(TypedIdConverters.OwnerAccountId);

        builder.Property(x => x.PlanCode).HasColumnName("plan_code");
        builder.Property(x => x.Status).HasColumnName("status");
        builder.Property(x => x.ValidFromUtc).HasColumnName("valid_from_utc");
        builder.Property(x => x.ValidUntilUtc).HasColumnName("valid_until_utc");
        builder.Property(x => x.TrialEndsAtUtc).HasColumnName("trial_ends_at_utc");
        builder.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc");
        builder.Property(x => x.UpdatedAtUtc).HasColumnName("updated_at_utc");
    }
}
