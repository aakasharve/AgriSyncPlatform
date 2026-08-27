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

        // ── DFES InsightEntry facets (dfes-companion-2026-07-11) — nullable, preserved ──
        builder.Property(x => x.Observation).HasColumnName("observation").HasColumnType("text");
        builder.Property(x => x.Change).HasColumnName("change").HasColumnType("text");
        builder.Property(x => x.Comparison).HasColumnName("comparison").HasColumnType("text");
        builder.Property(x => x.Challenge).HasColumnName("challenge").HasColumnType("text");
        builder.Property(x => x.Uncertainty).HasColumnName("uncertainty").HasColumnType("text");
        builder.Property(x => x.Hypothesis).HasColumnName("hypothesis").HasColumnType("text");
        builder.Property(x => x.Evidence).HasColumnName("evidence").HasColumnType("text");
        builder.Property(x => x.Learning).HasColumnName("learning").HasColumnType("text");
        builder.Property(x => x.NextAction).HasColumnName("next_action").HasColumnType("text");
        builder.Property(x => x.CropStage).HasColumnName("crop_stage").HasMaxLength(40);
        builder.Property(x => x.FarmerConfirmedSummary).HasColumnName("farmer_confirmed_summary").HasColumnType("text");
        builder.Property(x => x.SourceQuestionId).HasColumnName("source_question_id");

        builder.HasIndex(x => x.DailyLogId).HasDatabaseName("ix_observation_events_daily_log_id");
        builder.Ignore(x => x.DomainEvents);
    }
}
