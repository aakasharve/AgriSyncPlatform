using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Dfes;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class QuestionEventConfiguration : IEntityTypeConfiguration<QuestionEvent>
{
    public void Configure(EntityTypeBuilder<QuestionEvent> builder)
    {
        builder.ToTable("question_events");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.DailyLogId).HasColumnName("daily_log_id");              // nullable FK
        builder.Property(x => x.FarmId).HasColumnName("farm_id").IsRequired();          // direct tenancy key
        builder.Property(x => x.PlotId).HasColumnName("plot_id");                       // nullable

        builder.Property(x => x.QuestionKey).HasColumnName("question_key").HasMaxLength(120).IsRequired();
        builder.Property(x => x.Crop).HasColumnName("crop").HasMaxLength(60).IsRequired();
        builder.Property(x => x.ExpectedStage).HasColumnName("expected_stage").HasMaxLength(60);
        builder.Property(x => x.ActualStageApplicability).HasColumnName("actual_stage_applicability").HasMaxLength(60);
        builder.Property(x => x.AnchorDateType).HasColumnName("anchor_date_type").HasMaxLength(40).IsRequired();
        builder.Property(x => x.TriggerType).HasColumnName("trigger_type").HasMaxLength(40).IsRequired();
        builder.Property(x => x.QuestionType).HasColumnName("question_type").HasMaxLength(40).IsRequired();
        builder.Property(x => x.Lens).HasColumnName("lens").HasMaxLength(20).IsRequired();
        builder.Property(x => x.DepthLevel).HasColumnName("depth_level").IsRequired();
        builder.Property(x => x.Priority).HasColumnName("priority").IsRequired();
        builder.Property(x => x.Cooldown).HasColumnName("cooldown").IsRequired();
        builder.Property(x => x.AnswerModes).HasColumnName("answer_modes").HasMaxLength(60).IsRequired();
        builder.Property(x => x.SafetyClass).HasColumnName("safety_class").HasMaxLength(20).IsRequired();
        builder.Property(x => x.AgronomistApproved).HasColumnName("agronomist_approved").IsRequired();
        builder.Property(x => x.MarathiApproved).HasColumnName("marathi_approved").IsRequired();
        builder.Property(x => x.BankVersion).HasColumnName("bank_version").HasMaxLength(40).IsRequired();
        builder.Property(x => x.QuestionEngineVersion).HasColumnName("question_engine_version").HasMaxLength(40).IsRequired();

        builder.Property(x => x.AnswerObservationId).HasColumnName("answer_observation_id");   // nullable
        builder.Property(x => x.ShownAtUtc).HasColumnName("shown_at_utc");                       // nullable
        builder.Property(x => x.TriggerReason).HasColumnName("trigger_reason").HasColumnType("text");
        builder.Property(x => x.WeatherContext).HasColumnName("weather_context").HasColumnType("text");
        builder.Property(x => x.Response).HasColumnName("response").HasColumnType("text");        // free-text — preserved
        builder.Property(x => x.StageConfirmed).HasColumnName("stage_confirmed");                 // nullable bool
        builder.Property(x => x.PhotoSubmitted).HasColumnName("photo_submitted");                 // nullable bool
        builder.Property(x => x.Skipped).HasColumnName("skipped");                                // nullable bool
        builder.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc").IsRequired();

        builder.HasIndex(x => x.FarmId).HasDatabaseName("ix_question_events_farm_id");
        builder.HasIndex(x => x.DailyLogId).HasDatabaseName("ix_question_events_daily_log_id");
        builder.Ignore(x => x.DomainEvents);
    }
}
