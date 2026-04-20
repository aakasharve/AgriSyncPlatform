using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.AI;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class DocumentExtractionSessionConfiguration : IEntityTypeConfiguration<DocumentExtractionSession>
{
    public void Configure(EntityTypeBuilder<DocumentExtractionSession> builder)
    {
        builder.ToTable("document_extraction_sessions");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("id")
            .ValueGeneratedNever();

        builder.Property(x => x.UserId)
            .HasColumnName("user_id")
            .IsRequired();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .IsRequired();

        builder.Property(x => x.DocumentType)
            .HasColumnName("document_type")
            .HasConversion<string>()
            .HasMaxLength(32)
            .IsRequired();

        builder.Property(x => x.Status)
            .HasColumnName("status")
            .HasConversion<string>()
            .HasMaxLength(32)
            .IsRequired();

        builder.Property(x => x.DraftResultJson)
            .HasColumnName("draft_result_json")
            .HasColumnType("text");

        builder.Property(x => x.VerifiedResultJson)
            .HasColumnName("verified_result_json")
            .HasColumnType("text");

        builder.Property(x => x.DraftConfidence)
            .HasColumnName("draft_confidence")
            .HasColumnType("numeric(5,4)");

        builder.Property(x => x.VerifiedConfidence)
            .HasColumnName("verified_confidence")
            .HasColumnType("numeric(5,4)");

        builder.Property(x => x.DraftProvider)
            .HasColumnName("draft_provider")
            .HasMaxLength(64);

        builder.Property(x => x.VerificationProvider)
            .HasColumnName("verification_provider")
            .HasMaxLength(64);

        builder.Property(x => x.DraftAiJobId)
            .HasColumnName("draft_ai_job_id");

        builder.Property(x => x.VerificationAiJobId)
            .HasColumnName("verification_ai_job_id");

        builder.Property(x => x.InputImagePath)
            .HasColumnName("input_image_path")
            .HasMaxLength(1024);

        builder.Property(x => x.InputMimeType)
            .HasColumnName("input_mime_type")
            .HasMaxLength(64);

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.Property(x => x.ModifiedAtUtc)
            .HasColumnName("modified_at_utc")
            .IsRequired();

        builder.HasIndex(x => new { x.UserId, x.CreatedAtUtc });
        builder.HasIndex(x => new { x.FarmId, x.Status });
    }
}
