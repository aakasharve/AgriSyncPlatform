using Accounts.Domain.Subscriptions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Accounts.Infrastructure.Persistence.Configurations;

internal sealed class SubscriptionWebhookEventConfiguration : IEntityTypeConfiguration<SubscriptionWebhookEvent>
{
    public void Configure(EntityTypeBuilder<SubscriptionWebhookEvent> builder)
    {
        builder.ToTable("subscription_webhook_events", AccountsDbContext.SchemaName);
        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("id");

        builder.Property(x => x.ProviderEventId)
            .HasColumnName("provider_event_id")
            .HasMaxLength(256)
            .IsRequired();

        // Unique index — the idempotency guard. Duplicate ProviderEventId → row exists → handler skips.
        builder.HasIndex(x => x.ProviderEventId)
            .IsUnique()
            .HasDatabaseName("ux_subscription_webhook_events_provider_event_id");

        builder.Property(x => x.EventType)
            .HasColumnName("event_type")
            .HasMaxLength(64)
            .IsRequired();

        builder.Property(x => x.SubscriptionId)
            .HasColumnName("subscription_id");

        builder.Property(x => x.ReceivedAtUtc)
            .HasColumnName("received_at_utc")
            .HasColumnType("timestamptz")
            .IsRequired();

        builder.Property(x => x.RawPayload)
            .HasColumnName("raw_payload")
            .HasColumnType("text")
            .IsRequired();
    }
}
