using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class DisturbanceEventConfiguration : IEntityTypeConfiguration<DisturbanceEvent>
{
    public void Configure(EntityTypeBuilder<DisturbanceEvent> builder)
    {
        builder.ToTable("disturbance_events");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.DailyLogId).HasColumnName("daily_log_id").IsRequired();

        builder.Property(x => x.Scope)
            .HasColumnName("scope").HasConversion<string>().HasMaxLength(10).IsRequired();
        builder.Property(x => x.Severity)
            .HasColumnName("severity").HasConversion<string>().HasMaxLength(10);   // nullable enum

        // PRESERVED free-text — unlimited `text`, never scrubbed (D-FREETEXT-PRESERVE-2026-06-29)
        builder.Property(x => x.Reason).HasColumnName("reason").HasColumnType("text").IsRequired();

        builder.Property(x => x.BlockedSegmentsJson).HasColumnName("blocked_segments").HasColumnType("jsonb"); // nullable
        builder.Property(x => x.WeatherEventId).HasColumnName("weather_event_id");   // nullable soft-ref, no FK
        builder.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc").IsRequired();

        builder.HasIndex(x => x.DailyLogId).HasDatabaseName("ix_disturbance_events_daily_log_id");
        builder.Ignore(x => x.DomainEvents);
    }
}
