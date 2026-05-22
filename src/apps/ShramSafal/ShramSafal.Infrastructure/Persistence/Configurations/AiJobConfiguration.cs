using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.AI;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class AiJobConfiguration : IEntityTypeConfiguration<AiJob>
{
    public void Configure(EntityTypeBuilder<AiJob> builder)
    {
        builder.ToTable("ai_jobs");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("id")
            .ValueGeneratedNever();

        builder.Property(x => x.IdempotencyKey)
            .HasColumnName("idempotency_key")
            .HasMaxLength(256)
            .IsRequired();

        builder.Property(x => x.OperationType)
            .HasColumnName("operation_type")
            .HasConversion<string>()
            .HasMaxLength(64)
            .IsRequired();

        builder.Property(x => x.UserId)
            .HasColumnName("user_id")
            .IsRequired();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .IsRequired();

        builder.Property(x => x.Status)
            .HasColumnName("status")
            .HasConversion<string>()
            .HasMaxLength(64)
            .IsRequired();

        builder.Property(x => x.InputContentHash)
            .HasColumnName("input_content_hash")
            .HasMaxLength(128);

        builder.Property(x => x.RawInputRef)
            .HasColumnName("raw_input_ref")
            .HasMaxLength(1024);

        builder.Property(x => x.InputSessionMetadataJson)
            .HasColumnName("input_session_metadata_json")
            .HasColumnType("jsonb");

        builder.Property(x => x.NormalizedResultJson)
            .HasColumnName("normalized_result_json")
            .HasColumnType("jsonb");

        builder.Property(x => x.InputSpeechDurationMs)
            .HasColumnName("input_speech_duration_ms");

        builder.Property(x => x.InputRawDurationMs)
            .HasColumnName("input_raw_duration_ms");

        builder.Property(x => x.SchemaVersion)
            .HasColumnName("schema_version")
            .HasMaxLength(32)
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.Property(x => x.CompletedAtUtc)
            .HasColumnName("completed_at_utc");

        builder.Property(x => x.TotalAttempts)
            .HasColumnName("total_attempts")
            .IsRequired();

        builder.Property(x => x.ModifiedAtUtc)
            .HasColumnName("modified_at_utc")
            .IsRequired();

        // ── SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 1.1 ──────────
        // Voice spine: six transcript variants + provider/model lineage +
        // referenced-date triple + diarized payload + extractor SHA. All
        // nullable for backfill safety; transcript_schema_version is the
        // only NOT NULL column and defaults to "v1.0" so EF can stamp
        // legacy rows during the migration.
        builder.Property(x => x.TranscriptCodemix)
            .HasColumnName("transcript_codemix")
            .HasColumnType("text");

        builder.Property(x => x.TranscriptEnglish)
            .HasColumnName("transcript_english")
            .HasColumnType("text");

        builder.Property(x => x.TranscriptEnglishRedacted)
            .HasColumnName("transcript_english_redacted")
            .HasColumnType("text");

        builder.Property(x => x.TranscriptVerbatim)
            .HasColumnName("transcript_verbatim")
            .HasColumnType("text");

        builder.Property(x => x.TranscriptTranslit)
            .HasColumnName("transcript_translit")
            .HasColumnType("text");

        builder.Property(x => x.TranscriptTranslate)
            .HasColumnName("transcript_translate")
            .HasColumnType("text");

        builder.Property(x => x.TranscriptProvider)
            .HasColumnName("transcript_provider")
            .HasMaxLength(64);

        builder.Property(x => x.TranscriptModelVersion)
            .HasColumnName("transcript_model_version")
            .HasMaxLength(128);

        builder.Property(x => x.TranscribedAtUtc)
            .HasColumnName("transcribed_at_utc");

        builder.Property(x => x.TranscriptSchemaVersion)
            .HasColumnName("transcript_schema_version")
            .HasMaxLength(16)
            .HasDefaultValue("v1.0")
            .IsRequired();

        // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 1.7 — the
        // extractor_code_sha column added in Phase 1.1 now lives on the
        // shared Provenance owned record (see ProvenanceConfiguration).
        // The physical column on ssf.ai_jobs stays in place; only the EF
        // ownership moved. No top-level mapping here on AiJob.

        builder.Property(x => x.ReferencedDate)
            .HasColumnName("referenced_date");

        builder.Property(x => x.ReferencedDateConfidence)
            .HasColumnName("referenced_date_confidence")
            .HasColumnType("numeric(5,4)");

        builder.Property(x => x.ReferencedDateReason)
            .HasColumnName("referenced_date_reason")
            .HasMaxLength(256);

        builder.Property(x => x.DiarizedTranscriptJson)
            .HasColumnName("diarized_transcript_json")
            .HasColumnType("jsonb");

        builder.OwnsOne(x => x.Provenance, p =>
        {
            p.ConfigureProvenance();
            // DATA_PRINCIPLE_SPINE sub-phase 01.4 (F1 snapshot drift fix) —
            // mirror the migration's (prompt_version, model_version) index.
            p.HasIndex(x => new { x.PromptVersion, x.ModelVersion })
                .HasDatabaseName("ix_ai_jobs_prompt_model");
        });
        builder.Navigation(x => x.Provenance).IsRequired();

        builder.HasMany(x => x.Attempts)
            .WithOne()
            .HasForeignKey(x => x.AiJobId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Navigation(x => x.Attempts).UsePropertyAccessMode(PropertyAccessMode.Field);

        builder.HasIndex(x => x.IdempotencyKey).IsUnique();
        builder.HasIndex(x => x.UserId);
        builder.HasIndex(x => x.FarmId);
        builder.HasIndex(x => x.Status);
        builder.HasIndex(x => x.CreatedAtUtc);
        // DATA_PRINCIPLE_SPINE sub-phase 01.4 (F1 snapshot drift fix) —
        // partial index on raw_input_ref where not null. Matches the
        // migration's filtered index used for fast S3-path lookups.
        builder.HasIndex(x => x.RawInputRef)
            .HasDatabaseName("ix_ai_jobs_raw_input_ref")
            .HasFilter("\"raw_input_ref\" IS NOT NULL");
    }
}
