using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class DailyLogConfiguration : IEntityTypeConfiguration<DailyLog>
{
    public void Configure(EntityTypeBuilder<DailyLog> builder)
    {
        builder.ToTable("daily_logs");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        builder.Property(x => x.PlotId)
            .HasColumnName("plot_id")
            .IsRequired();

        builder.Property(x => x.CropCycleId)
            .HasColumnName("crop_cycle_id")
            .IsRequired();

        builder.Property(x => x.OperatorUserId)
            .HasColumnName("operator_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.LogDate)
            .HasColumnName("log_date")
            .IsRequired();

        builder.Property(x => x.IdempotencyKey)
            .HasColumnName("idempotency_key")
            .HasMaxLength(150);

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.OwnsOne(x => x.Location, location =>
        {
            location.Property(x => x.Latitude)
                .HasColumnName("location_latitude")
                .HasPrecision(10, 7);

            location.Property(x => x.Longitude)
                .HasColumnName("location_longitude")
                .HasPrecision(10, 7);

            location.Property(x => x.AccuracyMeters)
                .HasColumnName("location_accuracy_meters")
                .HasPrecision(10, 2);

            location.Property(x => x.Altitude)
                .HasColumnName("location_altitude")
                .HasPrecision(10, 2);

            location.Property(x => x.CapturedAtUtc)
                .HasColumnName("location_captured_at_utc");

            location.Property(x => x.Provider)
                .HasColumnName("location_provider")
                .HasMaxLength(20);

            location.Property(x => x.PermissionState)
                .HasColumnName("location_permission_state")
                .HasMaxLength(20);
        });

        builder.Navigation(x => x.Location).IsRequired(false);

        builder.HasIndex(x => x.IdempotencyKey)
            .IsUnique()
            .HasFilter("idempotency_key IS NOT NULL");

        builder.HasMany(x => x.Tasks)
            .WithOne()
            .HasForeignKey(x => x.DailyLogId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasMany(x => x.VerificationEvents)
            .WithOne()
            .HasForeignKey(x => x.DailyLogId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Navigation(x => x.Tasks).UsePropertyAccessMode(PropertyAccessMode.Field);
        builder.Navigation(x => x.VerificationEvents).UsePropertyAccessMode(PropertyAccessMode.Field);

        builder.Ignore(x => x.CurrentVerificationStatus);
        builder.Ignore(x => x.LastVerificationStatus);
        builder.Ignore(x => x.DomainEvents);
    }
}
