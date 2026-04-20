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

        builder.Property(x => x.InputStoragePath)
            .HasColumnName("input_storage_path")
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
    }
}
