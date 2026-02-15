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

        builder.HasIndex(x => new { x.DailyLogId, x.OccurredAtUtc });
        builder.Ignore(x => x.DomainEvents);
    }
}

