using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.OCR;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class OcrResultConfiguration : IEntityTypeConfiguration<OcrResult>
{
    public void Configure(EntityTypeBuilder<OcrResult> builder)
    {
        builder.ToTable("ocr_results");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.AttachmentId)
            .HasColumnName("attachment_id")
            .IsRequired();

        builder.Property(x => x.RawText)
            .HasColumnName("raw_text")
            .HasColumnType("text")
            .IsRequired();

        builder.Property(x => x.ExtractedFieldsJson)
            .HasColumnName("extracted_fields_json")
            .HasColumnType("text")
            .IsRequired();

        builder.Property(x => x.OverallConfidence)
            .HasColumnName("overall_confidence")
            .HasPrecision(6, 4)
            .IsRequired();

        builder.Property(x => x.ModelUsed)
            .HasColumnName("model_used")
            .HasMaxLength(120)
            .IsRequired();

        builder.Property(x => x.LatencyMs)
            .HasColumnName("latency_ms")
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.HasIndex(x => x.AttachmentId);
        builder.Ignore(x => x.DomainEvents);
    }
}
