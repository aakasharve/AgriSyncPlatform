// spec: data-principle-spine-2026-05-05/10.2
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Privacy.Pii;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 10 sub-phase 10.2 — EF mapping for
/// <see cref="PiiReviewQueueEntry"/>. Backed by
/// <c>ssf.pii_review_queue</c>; admin-only surface so no RLS
/// (allowlisted in <c>RlsExemptionAllowlistTests</c>). Detection
/// payload stored as <c>jsonb</c> for in-DB inspection.
/// </summary>
internal sealed class PiiReviewQueueEntryConfiguration : IEntityTypeConfiguration<PiiReviewQueueEntry>
{
    public void Configure(EntityTypeBuilder<PiiReviewQueueEntry> b)
    {
        b.ToTable("pii_review_queue", "ssf");
        b.HasKey(x => x.Id);

        b.Property(x => x.Id)
            .HasColumnName("id")
            .IsRequired();

        b.Property(x => x.TranscriptId)
            .HasColumnName("transcript_id")
            .IsRequired();

        b.Property(x => x.OriginalText)
            .HasColumnName("original_text")
            .HasColumnType("text")
            .IsRequired();

        b.Property(x => x.RedactedText)
            .HasColumnName("redacted_text")
            .HasColumnType("text")
            .IsRequired();

        b.Property(x => x.DetectionJson)
            .HasColumnName("detection_json")
            .HasColumnType("jsonb")
            .IsRequired();

        b.Property(x => x.Status)
            .HasColumnName("status")
            .HasConversion<string>()
            .HasMaxLength(24)
            .IsRequired();

        b.Property(x => x.ReviewedByUserId)
            .HasColumnName("reviewed_by_user_id");

        b.Property(x => x.ReviewNote)
            .HasColumnName("review_note")
            .HasMaxLength(2048);

        b.Property(x => x.OccurredAtUtc)
            .HasColumnName("occurred_at_utc")
            .HasColumnType("timestamp with time zone")
            .IsRequired();

        b.Property(x => x.ReviewedAtUtc)
            .HasColumnName("reviewed_at_utc")
            .HasColumnType("timestamp with time zone");

        b.HasIndex(x => x.Status)
            .HasDatabaseName("ix_pii_review_queue_status");

        b.HasIndex(x => x.TranscriptId)
            .HasDatabaseName("ix_pii_review_queue_transcript_id");
    }
}
