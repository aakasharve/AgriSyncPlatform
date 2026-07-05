using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class WeatherStampConfiguration : IEntityTypeConfiguration<WeatherStamp>
{
    public void Configure(EntityTypeBuilder<WeatherStamp> builder)
    {
        builder.ToTable("weather_stamps");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.DailyLogId).HasColumnName("daily_log_id").IsRequired();
        builder.Property(x => x.PlotId).HasColumnName("plot_id");

        builder.Property(x => x.TimestampLocal).HasColumnName("timestamp_local").IsRequired();
        builder.Property(x => x.TimestampProvider).HasColumnName("timestamp_provider").IsRequired();
        builder.Property(x => x.Provider).HasColumnName("provider").HasConversion<string>().HasMaxLength(20).IsRequired();

        builder.Property(x => x.TempC).HasColumnName("temp_c").IsRequired();
        builder.Property(x => x.Humidity).HasColumnName("humidity").IsRequired();
        builder.Property(x => x.WindKph).HasColumnName("wind_kph").IsRequired();
        builder.Property(x => x.PrecipMm).HasColumnName("precip_mm").IsRequired();
        builder.Property(x => x.CloudCoverPct).HasColumnName("cloud_cover_pct").IsRequired();
        builder.Property(x => x.ConditionText).HasColumnName("condition_text").HasMaxLength(80).IsRequired();
        builder.Property(x => x.IconCode).HasColumnName("icon_code").HasMaxLength(40).IsRequired();
        builder.Property(x => x.RainProbNext6h).HasColumnName("rain_prob_next_6h").IsRequired();

        builder.Property(x => x.WindGustKph).HasColumnName("wind_gust_kph");
        builder.Property(x => x.SoilMoisture0To10).HasColumnName("soil_moisture_0_10");
        builder.Property(x => x.UvIndex).HasColumnName("uv_index");
        builder.Property(x => x.AlertsJson).HasColumnName("alerts").HasColumnType("jsonb");
        builder.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc").IsRequired();

        builder.HasIndex(x => x.DailyLogId).HasDatabaseName("ix_weather_stamps_daily_log_id");
        builder.Ignore(x => x.DomainEvents);
    }
}
