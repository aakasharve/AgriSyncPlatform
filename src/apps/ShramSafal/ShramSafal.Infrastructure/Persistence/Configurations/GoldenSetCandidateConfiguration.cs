using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.AI;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 3.3 (data-eng brief
/// Theme B-2, Safeguard B2) — golden-set feedback-loop candidate row.
/// Mapped to <c>ssf.golden_set_candidate</c>. Unique on the tuple
/// <c>(audio_content_hash, correction_type)</c> so re-runs of the
/// feedback worker over the same correction are idempotent.
/// </summary>
internal sealed class GoldenSetCandidateConfiguration : IEntityTypeConfiguration<GoldenSetCandidate>
{
    public void Configure(EntityTypeBuilder<GoldenSetCandidate> builder)
    {
        builder.ToTable("golden_set_candidate");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("id")
            .ValueGeneratedNever();

        builder.Property(x => x.AudioContentHash)
            .HasColumnName("audio_content_hash")
            .HasColumnType("char(64)")
            .HasMaxLength(64)
            .IsRequired();

        builder.Property(x => x.UserId)
            .HasColumnName("user_id")
            .IsRequired();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .IsRequired();

        builder.Property(x => x.BucketId)
            .HasColumnName("bucket_id")
            .HasMaxLength(64)
            .IsRequired();

        builder.Property(x => x.CorrectionType)
            .HasColumnName("correction_type")
            .HasMaxLength(32)
            .IsRequired();

        builder.Property(x => x.AiSuggestedJson)
            .HasColumnName("ai_suggested_json")
            .HasColumnType("jsonb")
            .IsRequired();

        builder.Property(x => x.FarmerCorrectedJson)
            .HasColumnName("farmer_corrected_json")
            .HasColumnType("jsonb")
            .IsRequired();

        builder.Property(x => x.TranscriptCodemix)
            .HasColumnName("transcript_codemix")
            .HasColumnType("text");

        builder.Property(x => x.TranscriptVerbatim)
            .HasColumnName("transcript_verbatim")
            .HasColumnType("text");

        builder.Property(x => x.PromptVersion)
            .HasColumnName("prompt_version")
            .HasMaxLength(64);

        builder.Property(x => x.ExtractorCodeSha)
            .HasColumnName("extractor_code_sha")
            .HasMaxLength(40);

        builder.Property(x => x.PromotedToGoldenSet)
            .HasColumnName("promoted_to_golden_set")
            .HasDefaultValue(false)
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.Property(x => x.PromotedAtUtc)
            .HasColumnName("promoted_at_utc");

        builder.HasIndex(x => new { x.AudioContentHash, x.CorrectionType })
            .IsUnique()
            .HasDatabaseName("ux_golden_set_candidate_audio_correction");

        builder.HasIndex(x => new { x.PromotedToGoldenSet, x.CreatedAtUtc })
            .HasDatabaseName("ix_golden_set_candidate_promoted_created");

        builder.HasIndex(x => x.BucketId)
            .HasDatabaseName("ix_golden_set_candidate_bucket");

        builder.HasIndex(x => x.UserId)
            .HasDatabaseName("ix_golden_set_candidate_user");
    }
}
