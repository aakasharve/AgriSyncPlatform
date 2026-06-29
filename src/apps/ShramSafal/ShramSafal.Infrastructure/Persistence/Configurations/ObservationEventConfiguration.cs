using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class ObservationEventConfiguration : IEntityTypeConfiguration<ObservationEvent>
{
    public void Configure(EntityTypeBuilder<ObservationEvent> builder)
    {
        builder.ToTable("observation_events");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.DailyLogId).HasColumnName("daily_log_id").IsRequired();
        builder.Property(x => x.PlotId).HasColumnName("plot_id");           // nullable

        builder.Property(x => x.NoteType)
            .HasColumnName("note_type").HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(x => x.Severity)
            .HasColumnName("severity").HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(x => x.Source)
            .HasColumnName("source").HasConversion<string>().HasMaxLength(10).IsRequired();

        // PRESERVED free-text — unlimited `text`, never scrubbed (D-FREETEXT-PRESERVE-2026-06-29)
        builder.Property(x => x.TextRaw).HasColumnName("text_raw").HasColumnType("text").IsRequired();
        builder.Property(x => x.TextCleaned).HasColumnName("text_cleaned").HasColumnType("text"); // nullable

        builder.Property(x => x.TagsJson).HasColumnName("tags").HasColumnType("jsonb");           // nullable generic payload

        builder.Property(x => x.LinkedActivityId).HasColumnName("linked_activity_id");            // nullable
        builder.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc").IsRequired();

        builder.HasIndex(x => x.DailyLogId).HasDatabaseName("ix_observation_events_daily_log_id");
        builder.Ignore(x => x.DomainEvents);
    }
}
