using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Finance;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class CostEntryConfiguration : IEntityTypeConfiguration<CostEntry>
{
    public void Configure(EntityTypeBuilder<CostEntry> builder)
    {
        builder.ToTable("cost_entries");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        builder.Property(x => x.PlotId)
            .HasColumnName("plot_id");

        builder.Property(x => x.CropCycleId)
            .HasColumnName("crop_cycle_id");

        builder.Property(x => x.Category)
            .HasColumnName("category")
            .HasMaxLength(80)
            .IsRequired();

        builder.Property(x => x.Description)
            .HasColumnName("description")
            .HasMaxLength(500)
            .IsRequired();

        builder.Property(x => x.Amount)
            .HasColumnName("amount")
            .HasPrecision(18, 2)
            .IsRequired();

        builder.Property(x => x.CurrencyCode)
            .HasColumnName("currency_code")
            .HasMaxLength(8)
            .IsRequired();

        builder.Property(x => x.EntryDate)
            .HasColumnName("entry_date")
            .IsRequired();

        builder.Property(x => x.CreatedByUserId)
            .HasColumnName("created_by_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.Property(x => x.ModifiedAtUtc)
            .HasColumnName("modified_at_utc")
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
                .HasMaxLength(50);

            location.Property(x => x.PermissionState)
                .HasColumnName("location_permission_state")
                .HasMaxLength(30);
        });
        builder.Navigation(x => x.Location).IsRequired(false);

        builder.Property(x => x.IsCorrected)
            .HasColumnName("is_corrected")
            .HasDefaultValue(false);

        builder.Property(x => x.IsFlagged)
            .HasColumnName("is_flagged")
            .HasDefaultValue(false)
            .IsRequired();

        builder.Property(x => x.FlagReason)
            .HasColumnName("flag_reason")
            .HasMaxLength(300);

        builder.HasIndex(x => new { x.EntryDate, x.FarmId });
        builder.HasIndex(x => x.ModifiedAtUtc);
        builder.Ignore(x => x.DomainEvents);
    }
}
