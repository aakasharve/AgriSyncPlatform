using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.AI;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE Task 1.3 — re-transcription audit
/// ledger. Mapped to <c>ssf.transcript_history</c>. Unique on the
/// tuple <c>(audio_content_hash, transcript_provider,
/// transcript_model_version, transcript_mode)</c> so the same audio
/// replayed against the same (provider, model, mode) is idempotent.
/// </summary>
internal sealed class TranscriptHistoryConfiguration : IEntityTypeConfiguration<TranscriptHistory>
{
    public void Configure(EntityTypeBuilder<TranscriptHistory> builder)
    {
        builder.ToTable("transcript_history");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("id")
            .ValueGeneratedNever();

        builder.Property(x => x.AudioContentHash)
            .HasColumnName("audio_content_hash")
            .HasColumnType("char(64)")
            .HasMaxLength(64)
            .IsRequired();

        builder.Property(x => x.TranscriptProvider)
            .HasColumnName("transcript_provider")
            .HasMaxLength(64)
            .IsRequired();

        builder.Property(x => x.TranscriptModelVersion)
            .HasColumnName("transcript_model_version")
            .HasMaxLength(128)
            .IsRequired();

        builder.Property(x => x.TranscriptMode)
            .HasColumnName("transcript_mode")
            .HasMaxLength(32)
            .IsRequired();

        builder.Property(x => x.TranscriptText)
            .HasColumnName("transcript_text")
            .HasColumnType("text")
            .IsRequired();

        builder.Property(x => x.PromptVersion)
            .HasColumnName("prompt_version")
            .HasMaxLength(64);

        builder.Property(x => x.ExtractorCodeSha)
            .HasColumnName("extractor_code_sha")
            .HasMaxLength(40);

        builder.Property(x => x.ProducedAtUtc)
            .HasColumnName("produced_at_utc")
            .IsRequired();

        builder
            .HasIndex(x => new
            {
                x.AudioContentHash,
                x.TranscriptProvider,
                x.TranscriptModelVersion,
                x.TranscriptMode
            })
            .IsUnique()
            .HasDatabaseName("ux_transcript_history_audio_provider_model_mode");

        builder.HasIndex(x => x.AudioContentHash)
            .HasDatabaseName("ix_transcript_history_audio_content_hash");

        builder.HasIndex(x => new { x.TranscriptProvider, x.TranscriptModelVersion })
            .HasDatabaseName("ix_transcript_history_provider_version");
    }
}
