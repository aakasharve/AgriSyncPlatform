using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Attachments;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class AttachmentConfiguration : IEntityTypeConfiguration<Attachment>
{
    public void Configure(EntityTypeBuilder<Attachment> builder)
    {
        builder.ToTable("attachments");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        builder.Property(x => x.LinkedEntityId)
            .HasColumnName("linked_entity_id");

        builder.Property(x => x.LinkedEntityType)
            .HasColumnName("linked_entity_type")
            .HasMaxLength(64);

        builder.Property(x => x.UploadedByUserId)
            .HasColumnName("uploaded_by_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.OriginalFileName)
            .HasColumnName("original_file_name")
            .HasMaxLength(255)
            .IsRequired();

        builder.Property(x => x.MimeType)
            .HasColumnName("mime_type")
            .HasMaxLength(120)
            .IsRequired();

        builder.Property(x => x.SizeBytes)
            .HasColumnName("size_bytes")
            .IsRequired();

        builder.Property(x => x.StoragePath)
            .HasColumnName("storage_path")
            .HasMaxLength(600)
            .IsRequired();

        builder.Property(x => x.Status)
            .HasColumnName("status")
            .HasConversion<string>()
            .HasMaxLength(32)
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.Property(x => x.FinalizedAtUtc)
            .HasColumnName("finalized_at_utc");

        builder.HasIndex(x => x.FarmId);
        builder.HasIndex(x => new { x.LinkedEntityId, x.LinkedEntityType });
        builder.HasIndex(x => x.UploadedByUserId);
        builder.Ignore(x => x.DomainEvents);
    }
}
