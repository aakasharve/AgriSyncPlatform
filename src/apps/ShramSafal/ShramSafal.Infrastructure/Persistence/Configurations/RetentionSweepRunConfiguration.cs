// spec: data-principle-spine-2026-05-05/08.1
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Privacy;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 08 sub-phase 08.1 — EF mapping for
/// <see cref="RetentionSweepRun"/>. Maps to
/// <c>ssf.retention_sweep_runs</c>. RLS-exempt (system-only writes,
/// admin-only reads).
/// </summary>
internal sealed class RetentionSweepRunConfiguration : IEntityTypeConfiguration<RetentionSweepRun>
{
    public void Configure(EntityTypeBuilder<RetentionSweepRun> b)
    {
        b.ToTable("retention_sweep_runs");
        b.HasKey(x => x.Id);

        b.Property(x => x.Id)
            .HasColumnName("id")
            .IsRequired();

        b.Property(x => x.OccurredAtUtc)
            .HasColumnName("occurred_at_utc")
            .HasColumnType("timestamp with time zone")
            .IsRequired();

        b.Property(x => x.TablesSwept)
            .HasColumnName("tables_swept")
            .HasMaxLength(512)
            .IsRequired();

        b.Property(x => x.RowsRemovedCount)
            .HasColumnName("rows_removed_count")
            .IsRequired();

        b.Property(x => x.S3ObjectsRemovedCount)
            .HasColumnName("s3_objects_removed_count")
            .IsRequired();

        b.HasIndex(x => x.OccurredAtUtc)
            .HasDatabaseName("ix_retention_sweep_runs_occurred");
    }
}
