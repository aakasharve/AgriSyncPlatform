using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.AI;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// DATA_PRINCIPLE_SPINE sub-phase 02.3 — warm-tier transcript persistence.
/// One row per <see cref="AiJobAttempt"/>; the unique index on
/// <c>ai_job_attempt_id</c> enforces the invariant.
/// </summary>
internal sealed class TranscriptConfiguration : IEntityTypeConfiguration<Transcript>
{
    public void Configure(EntityTypeBuilder<Transcript> b)
    {
        b.ToTable("transcripts", "ssf");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("id");
        b.Property(x => x.AiJobId).HasColumnName("ai_job_id").IsRequired();
        b.Property(x => x.AiJobAttemptId).HasColumnName("ai_job_attempt_id").IsRequired();
        b.Property(x => x.Text).HasColumnName("text").HasColumnType("text").IsRequired();
        b.Property(x => x.LanguageTag).HasColumnName("language_tag").HasMaxLength(16).IsRequired();
        b.Property(x => x.PerTokenConfidenceJson).HasColumnName("per_token_confidence").HasColumnType("jsonb").IsRequired();
        b.Property(x => x.ProducedAtUtc).HasColumnName("produced_at_utc").IsRequired();
        b.HasIndex(x => x.AiJobId).HasDatabaseName("ix_transcripts_ai_job_id");
        b.HasIndex(x => x.AiJobAttemptId).IsUnique().HasDatabaseName("ux_transcripts_ai_job_attempt_id");
    }
}
