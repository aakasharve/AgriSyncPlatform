using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Dfes;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class DailyRichnessAggregateConfiguration : IEntityTypeConfiguration<DailyRichnessAggregate>
{
    public void Configure(EntityTypeBuilder<DailyRichnessAggregate> builder)
    {
        builder.ToTable("daily_richness_aggregates");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.FarmId).HasColumnName("farm_id").IsRequired();          // direct tenancy key
        builder.Property(x => x.LocalDate).HasColumnName("local_date").HasColumnType("date").IsRequired();
        builder.Property(x => x.TimeZone).HasColumnName("time_zone").HasMaxLength(40).IsRequired().HasDefaultValue("Asia/Kolkata");

        builder.Property(x => x.ExecutionScore).HasColumnName("execution_score");       // nullable
        builder.Property(x => x.InsightScore).HasColumnName("insight_score");           // nullable
        builder.Property(x => x.LearningScore).HasColumnName("learning_score");         // nullable

        builder.Property(x => x.DayClassification)
            .HasColumnName("day_classification").HasConversion<string>().HasMaxLength(30).IsRequired();

        builder.Property(x => x.HasWork).HasColumnName("has_work").IsRequired();
        builder.Property(x => x.HasMeaningfulObservation).HasColumnName("has_meaningful_observation").IsRequired();
        builder.Property(x => x.HasLearning).HasColumnName("has_learning").IsRequired();
        builder.Property(x => x.HasExperimentOutcome).HasColumnName("has_experiment_outcome").IsRequired();
        builder.Property(x => x.HasDisturbance).HasColumnName("has_disturbance").IsRequired();
        builder.Property(x => x.HasDeclaredNoWorkReason).HasColumnName("has_declared_no_work_reason").IsRequired();

        builder.Property(x => x.AdvancesStreak).HasColumnName("advances_streak").IsRequired();
        builder.Property(x => x.AdvancesBar).HasColumnName("advances_bar").IsRequired();
        builder.Property(x => x.ShramPointsEarned).HasColumnName("shram_points_earned").IsRequired();

        builder.Property(x => x.RewardReasonsJson).HasColumnName("reward_reasons").HasColumnType("jsonb").IsRequired();
        builder.Property(x => x.NoWorkReasonCode).HasColumnName("no_work_reason_code").HasMaxLength(60);       // nullable
        builder.Property(x => x.ExpectedStage).HasColumnName("expected_stage").HasMaxLength(60);               // nullable
        builder.Property(x => x.FarmerConfirmedActualStage).HasColumnName("farmer_confirmed_actual_stage").HasMaxLength(60); // nullable
        builder.Property(x => x.StageVarianceDays).HasColumnName("stage_variance_days");                       // nullable

        builder.Property(x => x.ScoreEngineVersion).HasColumnName("score_engine_version").HasMaxLength(40).IsRequired();
        builder.Property(x => x.ComponentsJson).HasColumnName("components_json").HasColumnType("jsonb").IsRequired();
        builder.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc").IsRequired();
        builder.Property(x => x.UpdatedAtUtc).HasColumnName("updated_at_utc").IsRequired();

        builder.HasIndex(x => new { x.FarmId, x.LocalDate })
            .HasDatabaseName("ux_daily_richness_farm_local_date").IsUnique();
        builder.Ignore(x => x.DomainEvents);
    }
}
