using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Wtl;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// EF mapping for the Work Trust Ledger v0 <see cref="WorkerAssignment"/>
/// link entity.
/// </summary>
/// <remarks>
/// DWC v2 §3.3 / ADR <c>2026-05-04 wtl-v0-entity-shape</c>.
/// </remarks>
internal sealed class WorkerAssignmentConfiguration : IEntityTypeConfiguration<WorkerAssignment>
{
    public void Configure(EntityTypeBuilder<WorkerAssignment> builder)
    {
        builder.ToTable("worker_assignments");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.WorkerId)
            .HasColumnName("worker_id")
            .IsRequired();

        builder.Property(x => x.DailyLogId)
            .HasColumnName("daily_log_id")
            .IsRequired();

        builder.Property(x => x.Confidence)
            .HasColumnName("confidence")
            .HasColumnType("numeric(3,2)")
            .IsRequired();

        builder.Property(x => x.OccurredAtUtc)
            .HasColumnName("occurred_at_utc")
            .IsRequired();

        builder.HasIndex(x => x.DailyLogId)
            .HasDatabaseName("ix_worker_assignments_log");

        builder.HasIndex(x => x.WorkerId)
            .HasDatabaseName("ix_worker_assignments_worker");

        builder.HasOne<Worker>()
            .WithMany()
            .HasForeignKey(x => x.WorkerId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
