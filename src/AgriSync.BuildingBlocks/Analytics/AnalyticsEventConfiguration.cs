using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace AgriSync.BuildingBlocks.Analytics;

internal sealed class AnalyticsEventConfiguration : IEntityTypeConfiguration<AnalyticsEvent>
{
    private static readonly ValueConverter<UserId?, Guid?> NullableUserIdConverter =
        new(id => id.HasValue ? id.Value.Value : (Guid?)null,
            value => value.HasValue ? new UserId(value.Value) : (UserId?)null);

    private static readonly ValueConverter<FarmId?, Guid?> NullableFarmIdConverter =
        new(id => id.HasValue ? id.Value.Value : (Guid?)null,
            value => value.HasValue ? new FarmId(value.Value) : (FarmId?)null);

    private static readonly ValueConverter<OwnerAccountId?, Guid?> NullableOwnerAccountIdConverter =
        new(id => id.HasValue ? id.Value.Value : (Guid?)null,
            value => value.HasValue ? new OwnerAccountId(value.Value) : (OwnerAccountId?)null);

    public void Configure(EntityTypeBuilder<AnalyticsEvent> builder)
    {
        builder.ToTable("events");
        builder.HasKey(x => x.EventId);

        builder.Property(x => x.EventId)
            .HasColumnName("event_id")
            .IsRequired();

        builder.Property(x => x.EventType)
            .HasColumnName("event_type")
            .HasMaxLength(80)
            .IsRequired();

        builder.Property(x => x.OccurredAtUtc)
            .HasColumnName("occurred_at_utc")
            .HasColumnType("timestamptz")
            .IsRequired();

        builder.Property(x => x.ActorUserId)
            .HasColumnName("actor_user_id")
            .HasConversion(NullableUserIdConverter);

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(NullableFarmIdConverter);

        builder.Property(x => x.OwnerAccountId)
            .HasColumnName("owner_account_id")
            .HasConversion(NullableOwnerAccountIdConverter);

        builder.Property(x => x.ActorRole)
            .HasColumnName("actor_role")
            .HasMaxLength(16)
            .IsRequired();

        builder.Property(x => x.Trigger)
            .HasColumnName("trigger")
            .HasMaxLength(24)
            .IsRequired();

        builder.Property(x => x.DeviceOccurredAtUtc)
            .HasColumnName("device_occurred_at_utc")
            .HasColumnType("timestamptz");

        builder.Property(x => x.SchemaVersion)
            .HasColumnName("schema_version")
            .HasMaxLength(8)
            .IsRequired()
            .HasDefaultValue("v1");

        builder.Property(x => x.PropsJson)
            .HasColumnName("props")
            .HasColumnType("jsonb")
            .IsRequired()
            .HasDefaultValueSql("'{}'::jsonb");

        builder.HasIndex(x => new { x.EventType, x.OccurredAtUtc })
            .HasDatabaseName("ix_analytics_events_type_time")
            .IsDescending(false, true);

        builder.HasIndex(x => new { x.FarmId, x.OccurredAtUtc })
            .HasDatabaseName("ix_analytics_events_farm_time")
            .IsDescending(false, true)
            .HasFilter("\"farm_id\" IS NOT NULL");

        builder.HasIndex(x => new { x.OwnerAccountId, x.OccurredAtUtc })
            .HasDatabaseName("ix_analytics_events_account_time")
            .IsDescending(false, true)
            .HasFilter("\"owner_account_id\" IS NOT NULL");

        builder.HasIndex(x => new { x.ActorUserId, x.OccurredAtUtc })
            .HasDatabaseName("ix_analytics_events_actor_time")
            .IsDescending(false, true)
            .HasFilter("\"actor_user_id\" IS NOT NULL");
    }
}
