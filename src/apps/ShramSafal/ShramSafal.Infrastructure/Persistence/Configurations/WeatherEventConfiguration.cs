using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class WeatherEventConfiguration : IEntityTypeConfiguration<WeatherEvent>
{
    public void Configure(EntityTypeBuilder<WeatherEvent> builder)
    {
        builder.ToTable("weather_events");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.FarmId).HasColumnName("farm_id").IsRequired();   // plain Guid, direct tenancy key
        builder.Property(x => x.PlotId).HasColumnName("plot_id");                // nullable

        builder.Property(x => x.EventType)
            .HasColumnName("event_type").HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(x => x.Severity)
            .HasColumnName("severity").HasConversion<string>().HasMaxLength(10).IsRequired();

        builder.Property(x => x.TsStart).HasColumnName("ts_start").IsRequired();
        builder.Property(x => x.TsEnd).HasColumnName("ts_end");                  // nullable
        builder.Property(x => x.SignalsJson).HasColumnName("signals").HasColumnType("jsonb"); // nullable
        builder.Property(x => x.Source).HasColumnName("source").HasMaxLength(60).IsRequired();
        builder.Property(x => x.LinkedLogId).HasColumnName("linked_log_id");     // nullable soft-ref, no FK
        builder.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc").IsRequired();

        builder.HasIndex(x => x.FarmId).HasDatabaseName("ix_weather_events_farm_id");
        builder.Ignore(x => x.DomainEvents);
    }
}
