using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class LogTaskConfiguration : IEntityTypeConfiguration<LogTask>
{
    public void Configure(EntityTypeBuilder<LogTask> builder)
    {
        builder.ToTable("log_tasks");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.DailyLogId)
            .HasColumnName("daily_log_id")
            .IsRequired();

        builder.Property(x => x.ActivityType)
            .HasColumnName("activity_type")
            .HasMaxLength(120)
            .IsRequired();

        builder.Property(x => x.Notes)
            .HasColumnName("notes")
            .HasMaxLength(500);

        builder.Property(x => x.OccurredAtUtc)
            .HasColumnName("occurred_at_utc")
            .IsRequired();

        // CEI Phase 1: execution status + deviation fields
        builder.Property(x => x.ExecutionStatus)
            .HasColumnName("execution_status")
            .HasDefaultValue(ExecutionStatus.Completed)
            .IsRequired();

        builder.Property(x => x.DeviationReasonCode)
            .HasColumnName("deviation_reason_code")
            .HasMaxLength(80);

        builder.Property(x => x.DeviationNote)
            .HasColumnName("deviation_note")
            .HasMaxLength(500);

        builder.HasIndex(x => new { x.DailyLogId, x.OccurredAtUtc });
        builder.Ignore(x => x.DomainEvents);

        // I-17: once stamped, immutable schedule compliance snapshot on the task.
        builder.OwnsOne(x => x.Compliance, compliance =>
        {
            compliance.Property(c => c.SubscriptionId)
                .HasColumnName("compliance_subscription_id")
                .HasConversion(TypedIdConverters.NullableScheduleSubscriptionId);

            compliance.Property(c => c.MatchedTaskId)
                .HasColumnName("compliance_matched_task_id")
                .HasConversion(TypedIdConverters.NullablePrescribedTaskId);

            compliance.Property(c => c.DeltaDays)
                .HasColumnName("compliance_delta_days");

            compliance.Property(c => c.Outcome)
                .HasColumnName("compliance_outcome")
                .HasConversion<int>()
                .IsRequired();
        });
    }
}
