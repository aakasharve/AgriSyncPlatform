using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class IrrigationEntryConfiguration : IEntityTypeConfiguration<IrrigationEntry>
{
    public void Configure(EntityTypeBuilder<IrrigationEntry> builder)
    {
        builder.ToTable("irrigation_entries");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.DailyLogId).HasColumnName("daily_log_id").IsRequired();

        builder.Property(x => x.Role)
            .HasColumnName("role").HasConversion<string>().HasMaxLength(20).IsRequired();

        builder.Property(x => x.WeatherAdjusted).HasColumnName("weather_adjusted").IsRequired();
        builder.Property(x => x.Method).HasColumnName("method").HasMaxLength(40);
        builder.Property(x => x.Source).HasColumnName("source").HasMaxLength(40);
        builder.Property(x => x.DurationHours).HasColumnName("duration_hours");
        builder.Property(x => x.WaterVolumeLitres).HasColumnName("water_volume_litres");
        builder.Property(x => x.LinkedActivityId).HasColumnName("linked_activity_id");
        builder.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc").IsRequired();

        builder.HasIndex(x => x.DailyLogId).HasDatabaseName("ix_irrigation_entries_daily_log_id");
        builder.Ignore(x => x.DomainEvents);
    }
}
